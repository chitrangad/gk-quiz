import express from 'express';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const app = express();
const PORT = 3000;
const DATA_DIR = './data';
const DATA_FILE = path.join(DATA_DIR, 'quiz.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.txt');

const QUIZ_CATEGORIES = {
  'General': 9, 'Books': 10, 'Film': 11, 'Music': 12, 'Television': 14,
  'Video Games': 15, 'Science & Nature': 17, 'Computers': 18, 'Mathematics': 19,
  'Sports': 21, 'Geography': 22, 'History': 23,
  'Art': 25, 'Animals': 27,
  'India': 'india'
};

const DIFFICULTIES = ['any', 'easy', 'medium', 'hard'];

// 6th grade math assignment categories
const MATH_CATEGORIES = {
  'Addition & Subtraction': 'addsub',
  'Multiplication & Division': 'muldiv',
  'Fractions': 'fractions',
  'Decimals': 'decimals',
  'Percentages': 'percentages',
  'Mixed Operations': 'mixed',
  'Word Problems': 'word'
};

async function initData() {
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(DATA_FILE)) {
    const init = { users: [{ name: 'Admin', password: 'admin', scores: [], mathScores: [] }] };
    await writeFile(DATA_FILE, JSON.stringify(init, null, 2));
  }
}

async function getData() {
  try {
    const data = await readFile(DATA_FILE, 'utf8');
    const parsed = data.trim()? JSON.parse(data) : { users: [] };
    // Migration: add mathScores array to existing users
    parsed.users = parsed.users.map(u => ({...u, mathScores: u.mathScores || [] }));
    return parsed;
  } catch (e) {
    console.error('Data read error:', e.message);
    return { users: [] };
  }
}

async function saveData(data) {
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

app.use(express.static('public'));
app.use(express.json());

// ============ QUIZ ROUTES ============
app.post('/api/register', async (req, res) => {
  const { username, password, secret } = req.body;
  if (!username ||!password ||!secret) {
    return res.status(400).json({ error: 'Username, password, and secret required' });
  }

  try {
    const realSecret = await readFile(SECRET_FILE, 'utf8');
    if (secret.trim()!== realSecret.trim()) {
      return res.status(403).json({ error: 'Invalid secret' });
    }
  } catch (err) {
    console.error('Secret read error:', err.message);
    return res.status(500).json({ error: 'Server config error' });
  }

  const data = await getData();
  if (data.users.find(u => u.name === username)) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  data.users.push({ name: username, password: password, scores: [], mathScores: [] });
  await saveData(data);
  res.json({ ok: true, username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username ||!password) return res.status(400).json({ error: 'Missing credentials' });
  const data = await getData();
  const user = data.users.find(u => u.name === username && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ ok: true, username: user.name });
});

app.get('/api/quiztypes', (req, res) => {
  res.json({ categories: QUIZ_CATEGORIES, difficulties: DIFFICULTIES });
});

app.get('/api/questions', async (req, res) => {
  const { type = 'General', difficulty = 'any', amount = 10 } = req.query;
  let questions = [];

  try {
    if (type === 'India') {
      let url = `https://the-trivia-api.com/v2/questions?tags=india&limit=${amount}`;
      if (difficulty!== 'any') url += `&difficulties=${difficulty}`;

      const r = await fetch(url);
      const data = await r.json();

      if (data && data.length > 0) {
        questions = data.map(q => {
          const opts = [...q.incorrectAnswers, q.correctAnswer].sort(() => Math.random() - 0.5);
          return {
            q: q.question.text,
            options: opts,
            a: opts.indexOf(q.correctAnswer),
            category: type,
            difficulty: q.difficulty
          };
        });
      } else {
        // Fallback India questions if API fails
        const fallback = [
          { q: 'What is the capital of India?', options: ['Mumbai', 'New Delhi', 'Kolkata', 'Chennai'], a: 1 },
          { q: 'Which river is known as Ganga?', options: ['Yamuna', 'Brahmaputra', 'Ganges', 'Godavari'], a: 2 },
          { q: 'Who is known as the Father of the Nation?', options: ['Nehru', 'Gandhi', 'Patel', 'Bose'], a: 1 },
          { q: 'National animal of India?', options: ['Lion', 'Tiger', 'Elephant', 'Peacock'], a: 1 },
          { q: 'India gained independence in?', options: ['1945', '1946', '1947', '1948'], a: 2 }
        ];
        questions = fallback.slice(0, parseInt(amount)).map(q => ({...q, category: type, difficulty }));
      }
    } else {
      const catId = QUIZ_CATEGORIES[type] || 9;
      let url = `https://opentdb.com/api.php?amount=${amount}&category=${catId}&type=multiple`;
      if (difficulty!== 'any') url += `&difficulty=${difficulty}`;

      const r = await fetch(url);
      const data = await r.json();

      if (data.response_code === 0) {
        questions = data.results.map(q => {
          const opts = [...q.incorrect_answers, q.correct_answer].sort(() => Math.random() - 0.5);
          return {
            q: q.question,
            options: opts,
            a: opts.indexOf(q.correct_answer),
            category: q.category,
            difficulty: q.difficulty
          };
        });
      }
    }
  } catch (err) {
    console.error('Question fetch error:', err.message);
    questions = [];
  }

  res.json(questions);
});

app.post('/api/score', async (req, res) => {
  const { user, score, date, type, difficulty } = req.body;
  const data = await getData();
  const userObj = data.users.find(u => u.name === user);
  if (!userObj) return res.status(400).json({ error: 'User not found' });

  userObj.scores.push({ score, date, type, difficulty });
  await saveData(data);
  res.json({ ok: true });
});

app.get('/api/leaderboard', async (req, res) => {
  const data = await getData();
  const board = data.users.map(u => {
    const arr = u.scores.map(s => s.score);
    return {
      user: u.name,
      games: arr.length,
      avg: arr.length? (arr.reduce((a,b)=>a+b,0) / arr.length).toFixed(1) : 0,
      best: arr.length? Math.max(...arr) : 0,
      total: arr.reduce((a,b)=>a+b,0)
    };
  }).sort((a,b) => b.total - a.total);
  res.json(board);
});

// ============ MATH TRIVIA ROUTES ============
app.get('/api/math-categories', (req, res) => {
  res.json({ categories: MATH_CATEGORIES });
});

app.get('/api/math-assignment', (req, res) => {
  const { type = 'addsub', count = 20 } = req.query;
  const problems = [];

  for (let i = 0; i < count; i++) {
    let q, answer;

    switch(type) {
      case 'addsub':
        const a1 = Math.floor(Math.random() * 900) + 100;
        const b1 = Math.floor(Math.random() * 900) + 100;
        if (Math.random() > 0.5) {
          q = `${a1} + ${b1} =?`;
          answer = a1 + b1;
        } else {
          q = `${Math.max(a1,b1)} - ${Math.min(a1,b1)} =?`;
          answer = Math.abs(a1 - b1);
        }
        break;

      case 'muldiv':
        if (Math.random() > 0.5) {
          const a2 = Math.floor(Math.random() * 12) + 2;
          const b2 = Math.floor(Math.random() * 12) + 2;
          q = `${a2} × ${b2} =?`;
          answer = a2 * b2;
        } else {
          answer = Math.floor(Math.random() * 12) + 2;
          const b2 = Math.floor(Math.random() * 12) + 2;
          const a2 = answer * b2;
          q = `${a2} ÷ ${b2} =?`;
        }
        break;

      case 'fractions':
        const den = [2,3,4,5,6,8,10][Math.floor(Math.random() * 7)];
        const num = Math.floor(Math.random() * (den-1)) + 1;
        const num2 = Math.floor(Math.random() * (den-1)) + 1;
        q = `${num}/${den} + ${num2}/${den} =?`;
        const sum = num + num2;
        answer = sum === den? '1' : `${sum}/${den}`;
        break;

      case 'decimals':
        const a3 = (Math.random() * 100).toFixed(2);
        const b3 = (Math.random() * 100).toFixed(2);
        q = `${a3} + ${b3} =?`;
        answer = (parseFloat(a3) + parseFloat(b3)).toFixed(2);
        break;

      case 'percentages':
        const perc = [10,20,25,50,75][Math.floor(Math.random() * 5)];
        const num3 = Math.floor(Math.random() * 20) * 10;
        q = `${perc}% of ${num3} =?`;
        answer = num3 * perc / 100;
        break;

      case 'mixed':
        const a4 = Math.floor(Math.random() * 20) + 5;
        const b4 = Math.floor(Math.random() * 10) + 2;
        const c4 = Math.floor(Math.random() * 10) + 2;
        q = `${a4} + ${b4} × ${c4} =?`;
        answer = a4 + b4 * c4;
        break;

      case 'word':
  const items = ['apples', 'books', 'students', 'pencils', 'marbles', 'cookies', 'stickers', 'erasers'];
  const item = items[Math.floor(Math.random() * items.length)];
  const names = ['Ava', 'Liam', 'Emma', 'Noah', 'Olivia', 'Ethan', 'Sofia', 'Lucas'];
  const name = names[Math.floor(Math.random() * names.length)];
  const pronoun = ['Ava','Emma','Olivia','Sofia'].includes(name) ? 'She' : 'He';
  const pronounLower = pronoun.toLowerCase();
  
  const wordType = Math.floor(Math.random() * 5);
  
  switch(wordType) {
    case 0: // Addition
      const a5 = Math.floor(Math.random() * 40) + 15;
      const b5 = Math.floor(Math.random() * 30) + 10;
      q = `${name} has ${a5} ${item}. ${pronoun} gets ${b5} more. How many ${item} does ${pronounLower} have now?`;
      answer = a5 + b5;
      break;
      
    case 1: // Subtraction  
      const s1 = Math.floor(Math.random() * 50) + 30;
      const s2 = Math.floor(Math.random() * (s1 - 10)) + 5;
      q = `${name} had ${s1} ${item}. ${pronoun} gave ${s2} to a friend. How many ${item} are left?`;
      answer = s1 - s2;
      break;
      
    case 2: // Multiplication
      const m1 = Math.floor(Math.random() * 10) + 3;
      const m2 = Math.floor(Math.random() * 12) + 4;
      q = `There are ${m1} bags. Each bag has ${m2} ${item}. How many ${item} are there in total?`;
      answer = m1 * m2;
      break;
      
    case 3: // Division - clean division only
      const d2 = Math.floor(Math.random() * 10) + 3;
      const quotient = Math.floor(Math.random() * 12) + 4;
      const d1 = d2 * quotient;
      q = `${name} shares ${d1} ${item} equally among ${d2} friends. How many ${item} does each friend get?`;
      answer = quotient;
      break;
      
    case 4: // 2-step: multiply then add
      const t1 = Math.floor(Math.random() * 7) + 3;
      const t2 = Math.floor(Math.random() * 6) + 3;
      const t3 = Math.floor(Math.random() * 15) + 5;
      q = `${name} buys ${t1} boxes with ${t2} ${item} each. ${pronoun} already had ${t3} ${item}. How many ${item} total?`;
      answer = (t1 * t2) + t3;
      break;
  }
  break;
    }
    problems.push({ id: i, q, answer });
  }

  res.json({ type, problems });
});

app.post('/api/math-score', async (req, res) => {
  const { user, score, total, date, category } = req.body;
  const data = await getData();
  const userObj = data.users.find(u => u.name === user);
  if (!userObj) return res.status(400).json({ error: 'User not found' });

  userObj.mathScores.push({ score, total, date, category, percent: ((score/total)*100).toFixed(1) });
  await saveData(data);
  res.json({ ok: true });
});

app.get('/api/math-leaderboard', async (req, res) => {
  const data = await getData();
  const board = data.users.map(u => {
    const arr = u.mathScores || [];
    const totalCorrect = arr.reduce((a,b) => a + b.score, 0);
    const totalQ = arr.reduce((a,b) => a + b.total, 0);
    return {
      user: u.name,
      assignments: arr.length,
      avg: totalQ? ((totalCorrect/totalQ)*100).toFixed(1) : 0,
      best: arr.length? Math.max(...arr.map(s => (s.score/s.total)*100)).toFixed(1) : 0,
      totalCorrect
    };
  }).filter(b => b.assignments > 0)
.sort((a,b) => parseFloat(b.avg) - parseFloat(a.avg));
  res.json(board);
});

initData().then(() => {
  app.listen(PORT, () => console.log(`Quiz running on http://localhost:${PORT}`));
});
