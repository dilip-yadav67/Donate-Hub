# DonateHub (MERN)
Donors list surplus food, books or medicines. NGOs nearby see them live (MongoDB geo queries + Socket.io) and claim them.

## Run
1. Start MongoDB (local or Atlas).
2. `cd server && cp .env.example .env && npm i && npm run dev`
3. `cd client && npm i && npm run dev` then open http://localhost:5173
4. Register one Donor and one NGO account (use two browsers) and try it.

## Deploy
Server on Render/Railway (set MONGO_URI, JWT_SECRET, CLIENT_URL). Client on Vercel with the same `/api` and `/socket.io` rewrites or a VITE API base.
