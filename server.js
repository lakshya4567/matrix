const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// Environment variables
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretmatrixkey';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Connect to Database
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Database connection error:', err));

// Schemas
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// Auth Middleware
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token.' });
    req.user = user;
    next();
  });
}

// Routes: Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Fill all fields' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    
    res.json({ message: 'User registered successfully!' });
  } catch (e) {
    res.status(400).json({ error: 'Username already exists or invalid data.' });
  }
});

// Routes: Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'User not found' });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid password' });
    
    const token = jwt.sign({ id: user._id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Routes: Get Chat History
app.get('/api/history', verifyToken, async (req, res) => {
  try {
    const messages = await Message.find({ userId: req.user.id }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Routes: Chat Endpoint (Calls OpenRouter & Stores in DB)
app.post('/api/chat', verifyToken, async (req, res) => {
  try {
    const { messages } = req.body; // Array of { role, content }
    const latestUserMessage = messages[messages.length - 1].content;

    // Save user message to DB
    await Message.create({ userId: req.user.id, role: 'user', content: latestUserMessage });

    // Call OpenRouter API
    const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://matrix-chatbot.onrender.com', // Optional site URL
        'X-Title': 'Matrix Chatbot' // Optional site name
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat:free', // You can change this to any OpenRouter model
        messages: messages
      })
    });

    const data = await aiResponse.json();
    if (!aiResponse.ok) {
      throw new Error(data.error?.message || 'OpenRouter API failed');
    }

    const aiResponseContent = data.choices[0].message.content;

    // Save assistant response to DB
    await Message.create({ userId: req.user.id, role: 'assistant', content: aiResponseContent });

    res.json({ content: aiResponseContent });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'AI processing failed' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
