const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretmatrixkey';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Database connection error:', err));

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});
const User = mongoose.model('User', UserSchema);

const ChatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: 'New Chat' },
  createdAt: { type: Date, default: Date.now }
});
const Chat = mongoose.model('Chat', ChatSchema);

const MessageSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  role: { type: String, required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied.' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token.' });
    req.user = user;
    next();
  });
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Fill all fields' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ username, password: hashedPassword });
    await newUser.save();
    res.json({ message: 'Registered successfully!' });
  } catch (e) {
    res.status(400).json({ error: 'Username already exists.' });
  }
});

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

app.get('/api/chats', verifyToken, async (req, res) => {
  try {
    const chats = await Chat.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(chats);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.post('/api/chats', verifyToken, async (req, res) => {
  try {
    const newChat = await Chat.create({ userId: req.user.id, title: 'New Chat' });
    res.json(newChat);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

app.get('/api/chats/:chatId/messages', verifyToken, async (req, res) => {
  try {
    const chat = await Chat.findOne({ _id: req.params.chatId, userId: req.user.id });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    const messages = await Message.find({ chatId: req.params.chatId }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/chats/:chatId/messages', verifyToken, async (req, res) => {
  try {
    const { messages } = req.body;
    const chatId = req.params.chatId;

    const chat = await Chat.findOne({ _id: chatId, userId: req.user.id });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });

    const latestUserMessage = messages[messages.length - 1].content;

    if (chat.title === 'New Chat') {
      chat.title = latestUserMessage.slice(0, 25) + (latestUserMessage.length > 25 ? '...' : '');
      await chat.save();
    }

    await Message.create({ chatId, role: 'user', content: latestUserMessage });

    // Format messages for Google Gemini API
    const geminiContents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Call Google Gemini API (Gemini 2.0 Flash)
    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: geminiContents })
    });

    const data = await aiResponse.json();
    if (!aiResponse.ok) {
      console.error('Gemini Error:', data);
      throw new Error(data.error?.message || 'Gemini API failed');
    }

    const aiResponseContent = data.candidates[0].content.parts[0].text;
    await Message.create({ chatId, role: 'assistant', content: aiResponseContent });

    res.json({ content: aiResponseContent, title: chat.title });
  } catch (e) {
    console.error('Chat endpoint error:', e);
    res.status(500).json({ error: e.message || 'AI processing failed' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
