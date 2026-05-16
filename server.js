const express      = require('express');
const cors         = require('cors');
const bodyParser   = require('body-parser');
const rateLimit    = require('express-rate-limit');
const { Chess }    = require('chess.js');
const { OpenAI }   = require('openai');
const { Groq }     = require('groq-sdk');
const { config }   = require('dotenv');

config();

const app = express();
const PORT = process.env.PORT || 3001;

const ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://chess-vishwas.netlify.app/',
];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: origin '${origin}' is not allowed`));
        }
    },
    methods: ['POST'],
}));
app.use(bodyParser.json());

const moveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests — please wait a moment before trying again.' },
});


// ── API clients ────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const groq    = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openRouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey:  process.env.OPENROUTER_API_KEY,
});

// ── Model registry ─────────────────────────────────────────────────────────
// Adding a new model = one entry here.  No other code changes needed.
// provider values:
//   'openai-completion'  → openai.completions.create  (instruct models)
//   'openai-chat'        → openai.chat.completions.create
//   'groq'               → groq.chat.completions.create
//   'openrouter'         → openRouter.chat.completions.create
const MODEL_REGISTRY = {
    // ── OpenAI ──────────────────────────────────────────────────────────────
    'gpt-3.5-turbo-instruct': { provider: 'openai-completion', id: 'gpt-3.5-turbo-instruct' },
    'gpt-4o-mini':            { provider: 'openai-chat',       id: 'gpt-4o-mini'            },

    // ── Groq (fast, free tier) ───────────────────────────────────────────────
    'llama-3.3-70b':          { provider: 'groq', id: 'llama-3.3-70b-versatile' },
    'llama-3.1-8b':           { provider: 'groq', id: 'llama-3.1-8b-instant'    },
    'mixtral-8x7b-32768':     { provider: 'groq', id: 'mixtral-8x7b-32768'      },
    'gemma2-9b-groq':         { provider: 'groq', id: 'gemma2-9b-it'            },

    // ── OpenRouter (free-tier models) ────────────────────────────────────────
    'gemma-7b-it':            { provider: 'openrouter', id: 'google/gemma-7b-it:free'                     },
    'gemma-2-9b':             { provider: 'openrouter', id: 'google/gemma-2-9b-it:free'                   },
    'openchat-7b':            { provider: 'openrouter', id: 'openchat/openchat-7b:free'                   },
    'nous-capybara-7b':       { provider: 'openrouter', id: 'nousresearch/nous-capybara-7b:free'          },
    'mistral-7b-instruct':    { provider: 'openrouter', id: 'mistralai/mistral-7b-instruct:free'          },
    'llama-3.1-8b-or':        { provider: 'openrouter', id: 'meta-llama/llama-3.1-8b-instruct:free'      },
    'phi-3-mini':             { provider: 'openrouter', id: 'microsoft/phi-3-mini-128k-instruct:free'     },
    'qwen-2-7b':              { provider: 'openrouter', id: 'qwen/qwen-2-7b-instruct:free'               },
};

// ── Prompt builders ────────────────────────────────────────────────────────

// System message shared by all chat-based providers.
// Strict constraints first — models comply better when limits are in system role.
const CHESS_SYSTEM_PROMPT =
    'You are a silent chess engine. ' +
    'Given a board position you must respond with exactly one legal move in standard algebraic notation (SAN). ' +
    'Rules: (1) Output only the move — no explanation, no commentary, no move number. ' +
    '(2) Do NOT append check (+) or checkmate (#) symbols. ' +
    '(3) If you output anything other than a single move token the response is invalid.';

// User message for chat models.
function buildChatUserMessage(fen, moves, turn, moveNumber) {
    return (
        `Position (FEN): ${fen}\n` +
        `Move number: ${moveNumber}\n` +
        `You are playing: ${turn}\n` +
        `Legal moves: ${moves.join(', ')}\n` +
        `Your move:`
    );
}

// Prompt for the legacy completion endpoint (gpt-3.5-turbo-instruct).
// Ends with "Move:" so the model fills in the blank directly.
function buildCompletionPrompt(fen, moves, turn, moveNumber) {
    return (
        `You are a chess engine. Output only one legal move in standard algebraic notation. No explanation.\n` +
        `FEN: ${fen}\n` +
        `Move number: ${moveNumber}\n` +
        `Color: ${turn}\n` +
        `Legal moves: ${moves.join(', ')}\n` +
        `Move:`
    );
}

// ── Move parser ────────────────────────────────────────────────────────────

// Strip check (+), checkmate (#), and quality annotations (!, ?) from a SAN move.
// LLMs routinely omit these suffixes even when the legal-move list includes them.
function stripAnnotations(san) {
    return san.replace(/[+#!?]+$/, '');
}

// Robustly extract a legal move from a free-form LLM response.
// Four-stage strategy (stops at first match):
//   1. Exact match of trimmed response against legal moves.
//   2. Normalised exact match (strips annotations from both sides).
//   3. Exact or normalised match on individual whitespace-split tokens.
//   4. Longest-first word-boundary regex on the full response text,
//      tried both with and without annotations.
function parseMoveFromResponse(responseText, legalMoves) {
    const trimmed = responseText.trim();

    // Pre-compute normalised → canonical map once
    const normalizedToCanonical = new Map();
    for (const m of legalMoves) {
        const norm = stripAnnotations(m);
        if (!normalizedToCanonical.has(norm)) normalizedToCanonical.set(norm, m);
    }

    // Stage 1 — exact
    if (legalMoves.includes(trimmed)) return trimmed;

    // Stage 2 — normalised exact
    const normTrimmed = stripAnnotations(trimmed);
    if (normalizedToCanonical.has(normTrimmed)) return normalizedToCanonical.get(normTrimmed);

    // Stage 3 — token-by-token (handles leading/trailing words in the response)
    const tokens = trimmed.split(/\s+/);
    for (const token of tokens) {
        const clean = token.replace(/^[.,!?;:'"()\[\]]+|[.,!?;:'"()\[\]]+$/g, '');
        if (legalMoves.includes(clean)) return clean;
        const normClean = stripAnnotations(clean);
        if (normalizedToCanonical.has(normClean)) return normalizedToCanonical.get(normClean);
    }

    // Stage 4 — whole-word substring, longest first (original annotations)
    const sortedByLength = [...legalMoves].sort((a, b) => b.length - a.length);
    for (const m of sortedByLength) {
        const escaped = m.replace(/[+#=]/g, '\\$&');
        if (new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`).test(responseText)) return m;
    }

    // Stage 4b — whole-word substring, longest first (stripped annotations)
    const sortedNorm = [...normalizedToCanonical.keys()].sort((a, b) => b.length - a.length);
    for (const norm of sortedNorm) {
        const escaped = norm.replace(/[+#=]/g, '\\$&');
        if (new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`).test(responseText)) {
            return normalizedToCanonical.get(norm);
        }
    }

    return null;
}

// ── Logging helpers ──────────────────────────────────────────────────────
const ts = () => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

const log = {
    info:    (...a) => console.log  (`[${ts()}] ℹ️  `, ...a),
    move:    (...a) => console.log  (`[${ts()}] ♟️  `, ...a),
    llm:     (...a) => console.log  (`[${ts()}] 🤖 `, ...a),
    parse:   (...a) => console.log  (`[${ts()}] 🔍 `, ...a),
    warn:    (...a) => console.warn (`[${ts()}] ⚠️  `, ...a),
    error:   (...a) => console.error(`[${ts()}] ❌ `, ...a),
    ok:      (...a) => console.log  (`[${ts()}] ✅ `, ...a),
    game:    (...a) => console.log  (`[${ts()}] 🏁 `, ...a),
    divider: ()    => console.log   (`${'─'.repeat(60)}`),
};

// ── /move endpoint ─────────────────────────────────────────────────────────
app.post('/move', moveLimiter, async (req, res) => {
    const { fen, turn: currTurn, model: currModel } = req.body;

    if (!fen || !currTurn || !currModel) {
        log.error('Missing required fields in request body');
        return res.status(400).json({ error: 'Missing required fields: fen, turn, model' });
    }
    if (currTurn !== 'w' && currTurn !== 'b') {
        log.error(`Invalid turn value: "${currTurn}"`);
        return res.status(400).json({ error: 'turn must be "w" or "b"' });
    }

    let chess;
    try {
        chess = new Chess(fen);
    } catch {
        log.error(`Invalid FEN received: "${fen}"`);
        return res.status(400).json({ error: 'Invalid FEN string' });
    }

    const legalMoves = chess.moves();
    const turn       = currTurn === 'w' ? 'white' : 'black';
    const moveNumber = parseInt(fen.split(' ')[5], 10) || 1;

    log.divider();
    log.info(`Move ${moveNumber} — ${turn.toUpperCase()} to move`);

    if (legalMoves.length === 0) {
        const winner = currTurn === 'w' ? 'black' : 'white';
        log.game(`No legal moves for ${turn}. Game over. Winner: ${winner.toUpperCase()}`);
        return res.json({ success: true, gameOver: true, winner });
    }

    const entry = MODEL_REGISTRY[currModel];
    if (!entry) {
        log.error(`Unknown model key: "${currModel}"`);
        return res.status(400).json({ error: `Unknown model: ${currModel}` });
    }

    log.llm(`Requesting move from ${entry.id} (${entry.provider})`);
    log.info(`Position FEN: ${fen}`);
    log.info(`Legal moves (${legalMoves.length}): ${legalMoves.join(', ')}`);

    const llmStart = Date.now();
    let moveResponse = '';
    try {
        if (entry.provider === 'openai-completion') {
            const prompt = buildCompletionPrompt(fen, legalMoves, turn, moveNumber);
            const response = await openai.completions.create({
                model: entry.id, prompt, max_tokens: 10, temperature: 0.6,
            });
            moveResponse = response.choices[0].text.trim();

        } else if (entry.provider === 'openai-chat') {
            const response = await openai.chat.completions.create({
                model: entry.id,
                messages: [
                    { role: 'system', content: CHESS_SYSTEM_PROMPT },
                    { role: 'user',   content: buildChatUserMessage(fen, legalMoves, turn, moveNumber) },
                ],
                max_tokens: 10, temperature: 0.6,
            });
            moveResponse = response.choices[0].message.content.trim();

        } else if (entry.provider === 'groq') {
            const response = await groq.chat.completions.create({
                model: entry.id,
                messages: [
                    { role: 'system', content: CHESS_SYSTEM_PROMPT },
                    { role: 'user',   content: buildChatUserMessage(fen, legalMoves, turn, moveNumber) },
                ],
                max_tokens: 10, temperature: 0.6,
            });
            moveResponse = response.choices[0].message.content.trim();

        } else if (entry.provider === 'openrouter') {
            const response = await openRouter.chat.completions.create({
                model: entry.id,
                messages: [
                    { role: 'system', content: CHESS_SYSTEM_PROMPT },
                    { role: 'user',   content: buildChatUserMessage(fen, legalMoves, turn, moveNumber) },
                ],
                max_tokens: 10, temperature: 0.6,
            });
            moveResponse = response.choices[0].message.content.trim();
        }

        const llmElapsed = Date.now() - llmStart;
        log.llm(`${entry.id} responded in ${llmElapsed}ms  →  raw: "${moveResponse}"`);

    } catch (error) {
        const llmElapsed = Date.now() - llmStart;
        log.error(`LLM API error after ${llmElapsed}ms — ${error?.message || String(error)}`);
        log.warn('Falling back to random move selection due to API failure');
    }

    const parsed = moveResponse ? parseMoveFromResponse(moveResponse, legalMoves) : null;
    let move;
    if (parsed) {
        move = parsed;
        log.parse(`Parsed LLM response → legal move: "${move}"`);
    } else {
        move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
        if (moveResponse) {
            log.warn(`Could not parse "${moveResponse}" as a legal move → random fallback: "${move}"`);
        } else {
            log.warn(`No response from LLM → random fallback: "${move}"`);
        }
    }

    try {
        chess.move(move);
    } catch {
        log.error(`chess.js rejected "${move}" — selecting emergency random fallback`);
        move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
        chess.move(move);
        log.warn(`Emergency fallback move applied: "${move}"`);
    }

    if (chess.isGameOver()) {
        let winner = null;
        let reason = 'unknown';
        if (chess.isCheckmate())            { winner = chess.turn() === 'w' ? 'black' : 'white'; reason = 'checkmate'; }
        else if (chess.isStalemate())        { reason = 'stalemate'; }
        else if (chess.isThreefoldRepetition()) { reason = 'threefold repetition'; }
        else if (chess.isInsufficientMaterial()) { reason = 'insufficient material'; }
        else if (chess.isDraw())             { reason = '50-move rule'; }

        log.move(`${turn.toUpperCase()} played: ${move}`);
        log.game(`═══ GAME OVER ═══  Reason: ${reason}${winner ? `  |  Winner: ${winner.toUpperCase()}` : '  |  Draw'}`);
        log.divider();
        return res.json({ success: true, move, gameOver: true, winner, fen: chess.fen() });
    }

    // Normal move — log piece type for extra context
    const pieceNames = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };
    const history = chess.history({ verbose: true });
    const lastApplied = history[history.length - 1];
    const pieceName = lastApplied ? (pieceNames[lastApplied.piece] || lastApplied.piece) : '';
    const captureNote = lastApplied?.captured ? `  (captures ${pieceNames[lastApplied.captured] || lastApplied.captured})` : '';
    const checkNote   = chess.isCheck() ? '  ⚠️  CHECK!' : '';

    log.move(`${turn.toUpperCase()} played: ${move}  [${pieceName} ${lastApplied?.from}→${lastApplied?.to}]${captureNote}${checkNote}`);
    log.ok(`Response sent. FEN: ${chess.fen()}`);

    return res.json({ success: true, move, gameOver: false, fen: chess.fen() });
});

app.listen(PORT, () => {
    log.divider();
    log.info(`AI Chess Arena backend running on http://localhost:${PORT}`);
    log.info(`Registered models: ${Object.keys(MODEL_REGISTRY).join(', ')}`);
    log.divider();
});
