// --- server.js ---
// Para rodar, você precisa ter o express e socket.io instalados:
// npm install express socket.io

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve os arquivos estáticos (html, css, js do cliente) da pasta atual
app.use(express.static(path.join(__dirname)));

// --- Lógica do Jogo no Servidor ---
let players = [];
let gameState = {
    letter: '',
    timer: 60,
    isRoundActive: false,
    timerInterval: null,
    answers: {}, // Armazena as respostas de todos os jogadores
    preferredTime: 60, // Tempo padrão inicial
    currentRoundResults: null // Armazena os resultados da rodada atual para modificação
};

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CATEGORIES = ['nome', 'animal', 'cidade', 'objeto', 'fruta', 'cor', 'profissao'];

function updatePlayerList() {
    const playerInfo = players.map(p => ({ id: p.id, name: p.name, score: p.score }));
    io.emit('updatePlayerList', playerInfo);
}

// Função auxiliar para remover acentos e converter para minúsculas
function normalizeString(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function calculateScores() {
    const allAnswers = {}; // Ex: { nome: ['ANA', 'AMANDA'], animal: ['ARARA'] }
    CATEGORIES.forEach(cat => allAnswers[cat] = []);

    // Agrupa todas as respostas válidas por categoria
    for (const playerId in gameState.answers) {
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
        const playerResult = { name: player.name, answers: {}, totalRoundScore: 0 };

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
    io.emit('showResults', gameState.currentRoundResults); // Envia os resultados armazenados
}


function endRound() {
    if (!gameState.isRoundActive) return;

    console.log('A rodada terminou.');
    gameState.isRoundActive = false;
    clearInterval(gameState.timerInterval);
    
    // 1. Avisa a todos que a rodada acabou e pede as respostas.
    io.emit('collectAnswers');
}


io.on('connection', (socket) => {
    console.log(`Novo jogador conectado: ${socket.id}`);

    socket.on('joinGame', ({ playerName }) => {
        const isHost = players.length === 0; // O primeiro jogador a entrar é o host
        players.push({ id: socket.id, name: playerName, score: 0, isHost: isHost });
        console.log(`${playerName} entrou no jogo.`);
        updatePlayerList();
        // Envia o tempo preferido atual para o novo jogador
        socket.emit('serverUpdateTimeOption', gameState.preferredTime);
    });

    socket.on('startGame', (data) => {
        if (gameState.isRoundActive) return;
        console.log('Iniciando o jogo...');

        // Usa o tempo preferido armazenado no gameState
        const roundTime = gameState.preferredTime;

        gameState.isRoundActive = true;
        gameState.letter = alphabet[Math.floor(Math.random() * alphabet.length)];
        gameState.timer = roundTime;
        gameState.answers = {}; // Limpa respostas da rodada anterior

        io.emit('gameStarted', { letter: gameState.letter, startTime: roundTime });

        gameState.timerInterval = setInterval(() => {
            gameState.timer--;
            io.emit('timerTick', { timeLeft: gameState.timer });
            if (gameState.timer <= 0) {
                endRound();
            }
        }, 1000);
    });
    
    // O jogador clicou em STOP
    socket.on('stopRound', () => {
        if (!gameState.isRoundActive) return;

        const player = players.find(p => p.id === socket.id);
        if (player) {
            io.emit('serverMessage', `${player.name} gritou STOP!`);
        }
        
        // Quando alguém aperta STOP, a rodada acaba para todos
        endRound();
    });

    // O líder da sala invalida uma palavra de um jogador
    socket.on('invalidateWord', ({ targetPlayerId, category }) => {
        const requestingPlayer = players.find(p => p.id === socket.id);

        // Apenas o líder pode invalidar e apenas se houver resultados para a rodada
        if (!requestingPlayer || !requestingPlayer.isHost || !gameState.currentRoundResults || !targetPlayerId) {
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
                io.emit('resultsUpdated', gameState.currentRoundResults);
                updatePlayerList(); // Atualiza a lista de jogadores com a nova pontuação total
            }
        }
    });
    // O cliente está enviando suas respostas após a coleta ser solicitada
    socket.on('submitAnswers', ({ answers }) => {
        if (players.some(p => p.id === socket.id)) {
            gameState.answers[socket.id] = answers;

            // Verifica se todos os jogadores já enviaram suas respostas
            const answeredPlayers = Object.keys(gameState.answers).length;
            if (answeredPlayers >= players.length) {
                calculateScores();
                updatePlayerList();
            }
        }
    });

    // Um jogador mudou a opção de tempo
    socket.on('clientUpdateTimeOption', (newTime) => {
        gameState.preferredTime = parseInt(newTime, 10) || 60;
        // Envia a nova opção de tempo para todos os outros clientes
        socket.broadcast.emit('serverUpdateTimeOption', gameState.preferredTime);
    });

    socket.on('restartGame', () => {
        console.log('Reiniciando o jogo para todos.');
        players.forEach(p => p.score = 0);
        gameState.currentRoundResults = null; // Limpa os resultados da rodada anterior
        if (gameState.isRoundActive) endRound(); // Para a rodada atual se houver uma
        io.emit('gameRestarted');
        updatePlayerList();
    });

    socket.on('disconnect', () => {
        const player = players.find(p => p.id === socket.id);
        if (player) {
            console.log(`${player.name} desconectou.`);
            players = players.filter(p => p.id !== socket.id);
            updatePlayerList();
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));