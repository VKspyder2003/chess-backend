# Chess Game Backend

This is the backend for a chess game application. It provides the necessary APIs for managing the game logic, moves, and interactions with the frontend.

## Technologies Used

- Node.js
- Express.js
- Chess.js
- Chat models APIs

## Installation

1. Clone the repository: `git clone https://github.com/VKspyder2003/chess-backend.git`
2. Install dependencies: `npm install`
3. Set up environment variables (see `.env.sample` for reference)
4. Start the server: `npm start`

## API Endpoints

- `POST /move`: Make a move in the chess game. Requires the current FEN (Forsyth–Edwards Notation) and the move to be made. Returns the updated FEN and game status.

## Deployment

- Current deployment : `https://chess-backend-rt09.onrender.com` 
- The backend can be deployed to a platform like Render for production use. Ensure that the environment variables are correctly set up for deployment.