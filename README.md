# ♟️ AI Chess Arena (Backend)

The Express.js backend for the AI Chess Arena. This service acts as the orchestration layer between the frontend chessboard and various Large Language Model (LLM) APIs. It manages game state validation, prompts the selected AI models, strictly parses their responses for legal chess moves, and gracefully handles fallbacks.

## Key Features

* **Multi-Provider LLM Routing:** Seamlessly routes move requests to OpenAI, Groq, or OpenRouter using a unified model registry.
* **Robust Move Parsing:** LLMs are notoriously bad at following strict formatting. This backend uses a custom 4-stage parsing algorithm (exact match, normalized match, token extraction, and regex substring matching) to extract valid Standard Algebraic Notation (SAN) moves from chatty AI responses.
* **Game State Validation:** Uses `chess.js` to validate the incoming FEN (Forsyth-Edwards Notation) and ensure the LLM's chosen move is strictly legal before sending it back to the client.
* **Failsafe Mechanisms:** If an LLM hallucinates an illegal move, times out, or API limits are hit, the server automatically falls back to a random legal move to keep the game flowing.
* **Detailed Console Logging:** Beautifully formatted, timestamped terminal logs for debugging model response times, raw outputs, parsing results, and piece movements.
* **Security & Rate Limiting:** Configured with strict CORS policies and IP-based rate limiting (30 requests/minute) to prevent API abuse.

## Tech Stack

* **Runtime:** Node.js
* **Framework:** Express.js
* **Chess Logic:** `chess.js`
* **AI SDKs:** `openai`, `groq-sdk`
* **Middleware:** `cors`, `body-parser`, `express-rate-limit`

## Getting Started

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/VKspyder2003/chess-backend.git
   cd chess-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Create a `.env` file in the root directory and add your API keys:
   ```env
   PORT=8000
   OPENAI_API_KEY=your_openai_key_here
   GROQ_API_KEY=your_groq_key_here
   OPENROUTER_API_KEY=your_openrouter_key_here
   ```

4. **Start the server:**
   ```bash
   node index.js
   ```
   The server will start on `http://localhost:8000` (or your defined port).

## API Documentation

### `POST /move`
Calculates the next move using the specified LLM.

**Request Body:**
```json
{
  "fen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "turn": "w",
  "model": "llama-3.3-70b"
}
```
* `fen` (string): The current board state in FEN format.
* `turn` (string): The side to move (`w` or `b`).
* `model` (string): The exact key of the model from the `MODEL_REGISTRY`.

**Success Response:**
```json
{
  "success": true,
  "move": "e4",
  "gameOver": false,
  "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
}
```

## Adding New Models

To add a new model, you do not need to touch the core logic. Simply add a new entry to the `MODEL_REGISTRY` object in your code:

```javascript
'new-model-key': { provider: 'openrouter', id: 'provider/actual-model-id' }
```
Supported providers are `openai-completion`, `openai-chat`, `groq`, and `openrouter`.

## Contributing
Contributions, issues, and feature requests are welcome! Feel free to check the issues page if you want to contribute.
