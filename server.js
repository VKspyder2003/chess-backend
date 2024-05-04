const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Chess } = require('chess.js');
const { OpenAI } = require('openai');
const { Groq } = require('groq-sdk');
const { config } = require('dotenv');

config();

const app = express();
const PORT = process.env.PORT || 3001
app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openRouter = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: process.env.OPENROUTER_API_KEY })

app.post('/move', async (req, res) => {

    const fen = req.body.fen;
    const currTurn = req.body.turn;
    const currModel = req.body.model;
    const chess = new Chess(fen);

    // Determine legal moves
    const moves = chess.moves();

    let response;
    let moveResponse;

    const turn = (currTurn === 'w') ? 'white' : 'black';

    try {
        if (currModel === 'gpt-3.5-turbo-instruct') {
            console.log(`ChatGPT playing ${turn}`)
            response = await openai.completions.create({
                model: 'gpt-3.5-turbo-instruct',
                prompt: `You are a world class chess player known for its clever moves and tactics.\n
                The current board position represented in FEN notation is \n${fen}\n
                Moves available are \n${moves}\n
                Choose the best move for ${turn} and return the move. Only return the output notation. Dont write anything else.`,
                max_tokens: 2500
            });

            // console.log(response.choices[0].text.trim())
            moveResponse = response.choices[0].text.trim();
        } else if (currModel === 'mistral-7b-instruct') {
            console.log(`Groq playing ${turn}`)
            response = await groq.chat.completions.create({
                model: 'mixtral-8x7b-32768',
                messages: [{
                    role: 'system', content: `The current board position represented in FEN notation is ${fen}\n
        Moves available are ${moves}\n
        Choose the best move for black and return the move. 
        Only output the best move. Dont give any explanation. Try to give the answer in one word`
                }],
                max_tokens: 2500
            })
            moveResponse = response.choices[0].message.content.trim();
        } else {
            let model = ''
            if (currModel === 'gemma-7b-it') {
                model = 'google/gemma-7b-it:free'
            } else if (currModel === 'openchat-7b') {
                model = 'openchat/openchat-7b:free'
            } else if (currModel === 'nous-capybara-7b') {
                model = 'nousresearch/nous-capybara-7b:free'
            } else {
                model = 'mistralai/mistral-7b-instruct:free'
            }
            console.log(`OpenRouter model ${currModel} playing ${turn}`);
            response = await openRouter.chat.completions.create({
                model: model,
                messages: [{
                    role: 'system',
                    content: `You are a world class chess player known for its clever moves and tactics.\n
                    The current board position represented in FEN notation is \n${fen}\n
                    Moves available are \n${moves}\n
                    Choose the best move for ${turn} and return the move. Only return the output notation. Dont write anything else.`
                }],
                max_tokens: 2500
            })
            console.log(response.choices[0].message.content.trim())
            moveResponse = response.choices[0].message.content.trim();
        }
    } catch (error) {
        if (moves.length === 0) {
            let winner = (turn === 'black') ? 'white' : 'black';
            res.json({
                success: true,
                gameOver: true,
                winner: winner
            });
            return;
        }
        moveResponse = moves[0]
    }

    let moveString = moveResponse;
    let move = 'random';

    if (moves.length === 0) {
        let winner = (turn === 'black') ? 'white' : 'black';
        res.json({
            success: true,
            gameOver: true,
            winner: winner
        });
    }

    for (let m of moves) {
        if (moveString.includes(m)) {
            move = m;
            break;
        }
    }
    console.log(`Available moves: ${moves}`)
    console.log(`Selected move: ${move}`)
    try {
        chess.move(move);
    } catch (error) {
        const randomIndex = Math.floor(Math.random() * moves.length);
        const randomMove = moves[randomIndex];
        chess.move(randomMove);
    }
    res.json({
        success: true,
        move: move,
        gameOver: false,
        fen: chess.fen() 
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
