const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const Groq = require('groq-sdk');

require('dotenv').config();

const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);
// const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Middleware
app.use(express.static(path.join(__dirname, 'app')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'index.html'));
});
app.get('/reserve', (req, res) => {
  res.sendFile(path.join(__dirname, 'app', 'reserve.html'));
});

// Socket.IO
io.on('connection', (socket) => {
  console.log('connection:', socket.id);

  socket.on('disconnect', () => {
    console.log('disconnected:', socket.id);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});