// --- server.js ---
// Para rodar, você precisa ter o express e socket.io instalados:
// npm install express socket.io dotenv
require('dotenv').config(); // Carrega as variáveis do arquivo .env

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { create } = require('domain');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Permite qualquer origem. Idealmente, restrinja para a URL do seu cliente após o deploy.
        methods: ["GET", "POST"]
    }
});

// Serve os arquivos estáticos (html, css, js do cliente) da pasta atual
app.use(express.static(path.join(__dirname)));

// --- Lógica do Jogo no Servidor ---
// Agora, em vez de um estado global, temos um Map para armazenar o estado de cada sala.
const rooms = new Map();

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CATEGORIES = ['nome', 'animal', 'cidade', 'objeto', 'fruta', 'cor', 'profissao'];

function createNewRoomState() {
    return {
        players: [],
        gameState: {
            letter: '',
            timer: 60,
            isRoundActive: false,
            timerInterval: null,
            answers: {},
            preferredTime: 60,
            currentRoundResults: null
        }
    };
}

function updatePlayerList(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    const playerInfo = room.players.map(p => ({ id: p.id, name: p.name, score: p.score, isHost: p.isHost }));
    io.to(roomId).emit('updatePlayerList', playerInfo);
}

// Função auxiliar para remover acentos e converter para minúsculas
function normalizeString(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function calculateScores(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    const { players, gameState } = room;
    const allAnswers = {}; // Ex: { nome: ['ANA', 'AMANDA'], animal: ['ARARA'] }
    CATEGORIES.forEach(cat => allAnswers[cat] = []);

    // Agrupa todas as respostas válidas por categoria
    for (const playerId in room.gameState.answers) {
        const playerAnswers = gameState.answers[playerId];
        CATEGORIES.forEach(cat => {
            const rawAnswer = playerAnswers[cat] || '';
            const normalizedAnswer = normalizeString(rawAnswer);
            const normalizedLetter = normalizeString(gameState.letter);
            if (normalizedAnswer && normalizedAnswer.startsWith(normalizedLetter)) {
                allAnswers[cat].push(normalizedAnswer);
            }
        });
    }

    const finalResults = {
        letter: gameState.letter,
        categories: CATEGORIES,
        playerResults: []
    };

    // Calcula os pontos para cada jogador e monta o objeto de resultados
    players.forEach(player => {
        // Pega as respostas do jogador. Se não houver, usa um objeto vazio.
        const playerAnswers = gameState.answers[player.id] || {};
        const playerResult = { id: player.id, name: player.name, answers: {}, totalRoundScore: 0 };

        // Verifica palavras duplicadas para ESTE jogador
        const usedWordsByPlayer = new Set();
        const duplicateWordsByPlayer = new Set();
        CATEGORIES.forEach(cat => {
            const normalizedAnswer = normalizeString(playerAnswers[cat] || '');
            if (normalizedAnswer) {
                if (usedWordsByPlayer.has(normalizedAnswer)) {
                    duplicateWordsByPlayer.add(normalizedAnswer);
                }
                usedWordsByPlayer.add(normalizedAnswer);
            }
        });

        // Calcula os pontos para cada categoria
        CATEGORIES.forEach(cat => {
            const rawAnswer = playerAnswers[cat] || '';
            const normalizedAnswer = normalizeString(rawAnswer); 
            const normalizedLetter = normalizeString(gameState.letter);
            let points = 0;
            if (normalizedAnswer && normalizedAnswer.startsWith(normalizedLetter) && !duplicateWordsByPlayer.has(normalizedAnswer)) {
                // Conta quantas vezes a mesma resposta apareceu
                const count = allAnswers[cat].filter(a => a === normalizedAnswer).length;
                points = (count > 1) ? 5 : 10; // 5 se for repetida, 10 se for única
            }
            playerResult.answers[cat] = { answer: rawAnswer, points };
            playerResult.totalRoundScore += points;
        });
        
        player.score += playerResult.totalRoundScore;
        playerResult.playerName = player.name; // Adiciona o nome para fácil identificação
        finalResults.playerResults.push(playerResult);
    });

    gameState.currentRoundResults = finalResults; // Armazena os resultados
    io.to(roomId).emit('showResults', gameState.currentRoundResults); // Envia os resultados armazenados
}


function endRound(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    const { gameState } = room;

    if (!gameState.isRoundActive) return;

    console.log(`Rodada terminou para a sala: ${roomId}`);
    gameState.isRoundActive = false;
    if (gameState.timerInterval) clearInterval(gameState.timerInterval);
    
    // 1. Avisa a todos que a rodada acabou e pede as respostas.
    io.to(roomId).emit('collectAnswers');
}


io.on('connection', (socket) => {
    console.log(`Novo jogador conectado: ${socket.id}`);

    socket.on('joinGame', ({ playerName, roomName }) => {
        // SANITIZAÇÃO: Limita o tamanho e remove caracteres que podem ser usados em ataques XSS.
        const sanitizedName = playerName.trim().substring(0, 20).replace(/[<>]/g, '');
        const sanitizedRoomName = roomName.trim().substring(0, 20).replace(/[^a-zA-Z0-9-_]/g, '');
        if (!sanitizedName || !sanitizedRoomName) return;

        // Cria a sala se ela não existir
        if (!rooms.has(sanitizedRoomName)) {
            rooms.set(sanitizedRoomName, createNewRoomState());
            console.log(`Sala criada: ${sanitizedRoomName}`);
        }

        const room = rooms.get(sanitizedRoomName);

        // Junta o socket à sala do socket.io
        socket.join(sanitizedRoomName);
        socket.roomId = sanitizedRoomName; // Armazena o ID da sala no socket para referência futura

        const isHost = room.players.length === 0; // O primeiro jogador a entrar é o host
        room.players.push({ id: socket.id, name: sanitizedName, score: 0, isHost: isHost });
        console.log(`${sanitizedName} entrou na sala ${sanitizedRoomName}.`);
        
        updatePlayerList(sanitizedRoomName);
        // Envia o tempo preferido atual para o novo jogador
        socket.emit('serverUpdateTimeOption', room.gameState.preferredTime);
    });

    socket.on('startGame', () => {
        const roomId = socket.roomId;
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const { gameState } = room;

        if (gameState.isRoundActive) return;
        console.log(`Iniciando o jogo na sala ${roomId}...`);

        // Usa o tempo preferido armazenado no gameState
        const roundTime = gameState.preferredTime;

        gameState.isRoundActive = true;
        gameState.letter = alphabet[Math.floor(Math.random() * alphabet.length)];
        gameState.timer = roundTime;
        gameState.answers = {}; // Limpa respostas da rodada anterior
        gameState.currentRoundResults = null;

        io.to(roomId).emit('gameStarted', { letter: gameState.letter, startTime: roundTime });

        gameState.timerInterval = setInterval(() => {
            gameState.timer--;
            io.to(roomId).emit('timerTick', { timeLeft: gameState.timer });
            if (gameState.timer <= 0) {
                endRound(roomId);
            }
        }, 1000);
    });
    
    // O jogador clicou em STOP
    socket.on('stopRound', () => {
        const roomId = socket.roomId;
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;

        if (!gameState.isRoundActive) return;

        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            io.to(roomId).emit('serverMessage', `${player.name} gritou STOP!`);
        }
        
        // Quando alguém aperta STOP, a rodada acaba para todos
        endRound(roomId);
    });

    // O líder da sala invalida uma palavra de um jogador
    socket.on('invalidateWord', ({ targetPlayerId, category }) => {
        const roomId = socket.roomId;
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const { players, gameState } = room;

        const requestingPlayer = players.find(p => p.id === socket.id);

        // Apenas o líder pode invalidar e apenas se houver resultados para a rodada
        if (!requestingPlayer || !requestingPlayer.isHost || !gameState.currentRoundResults) {
            return;
        }

        const targetPlayer = players.find(p => p.id === targetPlayerId);
        const playerResult = targetPlayer ? gameState.currentRoundResults.playerResults.find(pr => pr.name === targetPlayer.name) : null;

        if (playerResult && targetPlayer) {
            const wordData = playerResult.answers[category];

            // Se a palavra já não valia 0, subtrai os pontos e marca como invalidada
            if (wordData && wordData.points > 0) {
                const pointsToSubtract = wordData.points;
                
                // Subtrai da pontuação total do jogador
                targetPlayer.score -= pointsToSubtract;

                // Subtrai da pontuação da rodada do jogador
                playerResult.totalRoundScore -= pointsToSubtract;

                // Zera os pontos da palavra e marca como invalidada
                wordData.points = 0;
                wordData.invalidated = true; // Adicionamos um marcador

                // Envia os resultados atualizados para todos os clientes
                io.to(roomId).emit('resultsUpdated', gameState.currentRoundResults);
                updatePlayerList(roomId); // Atualiza a lista de jogadores com a nova pontuação total
            }
        }
    });
    // O cliente está enviando suas respostas após a coleta ser solicitada
    socket.on('submitAnswers', ({ answers }) => {
        const roomId = socket.roomId;
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const { players, gameState } = room;

        if (players.some(p => p.id === socket.id)) {
            gameState.answers[socket.id] = answers;

            // Verifica se todos os jogadores já enviaram suas respostas
            const answeredPlayers = Object.keys(gameState.answers).length;
            if (answeredPlayers >= players.length) {
                calculateScores(roomId);
                updatePlayerList(roomId);
            }
        }
    });

    // Um jogador mudou a opção de tempo
    socket.on('clientUpdateTimeOption', (newTime) => {
        const roomId = socket.roomId;
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const { gameState } = room;

        gameState.preferredTime = parseInt(newTime, 10) || 60;
        // Envia a nova opção de tempo para todos os outros clientes
        socket.to(roomId).broadcast.emit('serverUpdateTimeOption', gameState.preferredTime);
    });

    socket.on('restartGame', () => {
        const roomId = socket.roomId;
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        const { players, gameState } = room;

        console.log(`Reiniciando o jogo para a sala ${roomId}.`);
        players.forEach(p => p.score = 0);
        gameState.currentRoundResults = null; // Limpa os resultados da rodada anterior
        if (gameState.isRoundActive) endRound(roomId); // Para a rodada atual se houver uma
        io.to(roomId).emit('gameRestarted');
        updatePlayerList(roomId);
    });

    socket.on('endGame', () => {
        const roomId = socket.roomId;
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;

        // Apenas coleta os dados dos jogadores (nome e pontuação)
        const finalRanking = room.players.map(p => ({ name: p.name, score: p.score }));

        // Envia o ranking para todos na sala
        io.to(roomId).emit('showFinalRanking', finalRanking);
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
            const player = room.players[playerIndex];
            console.log(`${player.name} desconectou da sala ${roomId}.`);
            room.players.splice(playerIndex, 1);

            // Se a sala ficar vazia, podemos removê-la para liberar memória
            if (room.players.length === 0) {
                if (room.gameState.timerInterval) clearInterval(room.gameState.timerInterval);
                rooms.delete(roomId);
                console.log(`Sala ${roomId} removida por estar vazia.`);
            } else {
                // Se o host se desconectou, elege um novo host (o próximo da lista)
                if (player.isHost) room.players[0].isHost = true;
                updatePlayerList(roomId);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));