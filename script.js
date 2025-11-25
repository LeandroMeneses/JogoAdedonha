document.addEventListener('DOMContentLoaded', () => {
    // Conecta ao servidor. Em um ambiente real, use 'http://seu-servidor.com'
    const socket = io();

    // --- Elementos do DOM ---
    const loginArea = document.getElementById('login-area');
    const gameArea = document.getElementById('game-area');
    const playerNameInput = document.getElementById('playerNameInput');
    const roomNameInput = document.getElementById('roomNameInput');
    const joinGameButton = document.getElementById('joinGameButton');

    const resultsModal = document.getElementById('results-modal');
    const finalRankingModal = document.getElementById('final-ranking-modal');
    const finalRankingContainer = document.getElementById('final-ranking-container');
    const closeRankingButton = document.getElementById('close-ranking-button');

    // Adicionamos uma variável para saber se o jogador atual é o líder
    let isCurrentUserHost = false;

    const resultsTableContainer = document.getElementById('results-table-container');
    const closeResultsButton = document.getElementById('close-results-button');

    const currentLetterDisplay = document.getElementById('current-letter');
    const scoreDisplay = document.getElementById('score');
    const timerDisplay = document.getElementById('timer');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const endGameButton = document.getElementById('endGameButton');
    const restartButton = document.getElementById('restartButton');
    const playersList = document.getElementById('players');
    const timeOptionsSelect = document.getElementById('timeOptions');
    const categoryInputs = document.querySelectorAll('.category-grid input[type="text"]');

    // --- Lógica de Validação do Cliente ---
    /**
     * Valida os campos de categoria para habilitar/desabilitar o botão de parar rodada.
     * O botão só é habilitado se todos os campos estiverem preenchidos e
     * todas as palavras começarem com a letra da rodada.
     */
    function validateInputs() {
        const currentLetter = currentLetterDisplay.textContent.trim().toUpperCase();

        // Não faz nada se a rodada não começou (letra '?' ou vazia)
        if (!currentLetter || currentLetter === '?') {
            stopButton.disabled = true;
            return;
        }

        let allFieldsFilled = true;
        let allWordsAreCorrect = true;
        let noDuplicates = true;

        // Primeiro, removemos todos os marcadores de duplicata para revalidar do zero
        categoryInputs.forEach(input => input.classList.remove('duplicate-word'));

        const usedWords = new Map();

        categoryInputs.forEach(input => {
            const value = input.value.trim().toUpperCase();

            if (value === '') {
                allFieldsFilled = false;
            } else {
                // Verifica se a palavra já foi usada em outro campo
                if (usedWords.has(value)) {
                    noDuplicates = false;
                    // Marca tanto o campo atual quanto o campo original como duplicados
                    input.classList.add('duplicate-word');
                    usedWords.get(value).classList.add('duplicate-word');
                } else {
                    usedWords.set(value, input);
                }
            }

            // Validação da letra inicial
            if (value !== '' && !value.startsWith(currentLetter)) {
                allWordsAreCorrect = false;
                input.classList.add('invalid-word');
            } else {
                input.classList.remove('invalid-word');
            }
        });
        
        stopButton.disabled = !(allFieldsFilled && allWordsAreCorrect && noDuplicates);
    }

    // --- Lógica de Login ---
    function attemptJoinGame() {
        const playerName = playerNameInput.value.trim();
        const roomName = roomNameInput.value.trim(); // Adicionado
        if (playerName && roomName) {
            socket.emit('joinGame', { playerName, roomName }); // Envia o nome da sala também
            loginArea.classList.add('hidden');
            gameArea.classList.remove('hidden');
        } else {
            alert('Por favor, digite seu nome e o nome da sala.');
        }
    }

    joinGameButton.addEventListener('click', attemptJoinGame);

    playerNameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            roomNameInput.focus(); // Pula para o campo da sala
        }
    });

    // Adiciona o ouvinte de evento para validar os campos em tempo real
    categoryInputs.forEach(input => {
        input.addEventListener('input', validateInputs);
    });

    // Adicionado para entrar no jogo com Enter no campo da sala
    roomNameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            attemptJoinGame();
        }
    });
    // --- Eventos dos Botões (Envia para o Servidor) ---
    // O botão Iniciar Jogo não precisa mais enviar o tempo, pois o servidor já sabe o tempo preferido
    startButton.addEventListener('click', () => {
        socket.emit('startGame');
    });

    // Envia a mudança de tempo para o servidor
    timeOptionsSelect.addEventListener('change', () => {
        socket.emit('clientUpdateTimeOption', timeOptionsSelect.value);
    });

    // Desabilita o seletor de tempo quando o jogo começa
    // Habilita quando o jogo termina/reinicia

    stopButton.addEventListener('click', () => {
        // Apenas informa ao servidor que este jogador apertou STOP
        socket.emit('stopRound');
    });

    restartButton.addEventListener('click', () => {
        // Apenas o "líder" da sala poderia fazer isso (lógica no servidor)
        socket.emit('restartGame');
    });

    endGameButton.addEventListener('click', () => {
        if (confirm('Tem certeza que deseja finalizar o jogo para todos? A pontuação final será exibida.')) {
            socket.emit('endGame');
        }
    });

    closeResultsButton.addEventListener('click', () => {
        resultsModal.classList.add('hidden');
    });
    closeRankingButton.addEventListener('click', () => {
        finalRankingModal.classList.add('hidden');
    });

    // --- Ouvindo Eventos do Servidor ---

    // Atualiza a lista de jogadores na sala
    socket.on('updatePlayerList', (players) => {
        playersList.innerHTML = '';
        players.forEach(player => {
            const li = document.createElement('li'); li.dataset.playerId = player.id; // Armazena o ID para referência futura
            if (player.id === socket.id) isCurrentUserHost = player.isHost;
            // Adiciona uma tag de "Líder" para o primeiro jogador
            li.innerHTML = `${player.name} - ${player.score} pontos ${player.isHost ? '<strong>(Líder)</strong>' : ''}`;
            playersList.appendChild(li);
        });
    });

    // O servidor informa que o jogo começou
    socket.on('gameStarted', (data) => {
        currentLetterDisplay.textContent = data.letter;
        scoreDisplay.textContent = '0'; // Zera pontuação da rodada no display
        
        // Atualiza o display do timer com o tempo inicial correto
        const minutes = Math.floor(data.startTime / 60);
        const seconds = data.startTime % 60; 
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

        categoryInputs.forEach(input => {
            input.disabled = false;
            input.value = '';
            input.classList.remove('input-correct', 'input-incorrect', 'invalid-word', 'duplicate-word');
        });

        startButton.disabled = true;
        stopButton.disabled = true; // Começa desabilitado, a validação irá habilitá-lo
        timeOptionsSelect.disabled = true; // Desabilita o seletor de tempo
    });

    // O servidor envia atualizações do cronômetro
    socket.on('timerTick', (data) => {
        const minutes = Math.floor(data.timeLeft / 60);
        const seconds = data.timeLeft % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    });

    // O servidor informa que a rodada acabou
    socket.on('collectAnswers', () => {
        // Desabilita os campos e o botão de stop
        categoryInputs.forEach(input => {
            input.disabled = true;
        });
        startButton.disabled = false;
        stopButton.disabled = true;
        timeOptionsSelect.disabled = false; // Habilita o seletor de tempo

        // Coleta as respostas e envia para o servidor
        const answers = {};
        categoryInputs.forEach(input => {
            answers[input.id] = input.value.trim();
        });
        socket.emit('submitAnswers', { answers });
        // A rodada terminou. O modal de resultados será exibido em breve.
    });

    // O servidor envia os resultados consolidados para todos
    socket.on('showResults', (data) => {
        renderResultsTable(data);
        resultsModal.classList.remove('hidden');
    });

    // O servidor envia uma atualização da tabela de resultados (após invalidação)
    socket.on('resultsUpdated', (data) => {
        renderResultsTable(data);
    });

    // O servidor envia o ranking final
    socket.on('showFinalRanking', (finalRanking) => {
        // Ordena os jogadores pela pontuação, do maior para o menor
        finalRanking.sort((a, b) => b.score - a.score);

        finalRankingContainer.innerHTML = ''; // Limpa o conteúdo anterior
        const ol = document.createElement('ol');

        finalRanking.forEach((player, index) => {
            const li = document.createElement('li');
            li.innerHTML = `${index + 1}º - ${player.name} com <strong>${player.score}</strong> pontos`;
            ol.appendChild(li);
        });

        finalRankingContainer.appendChild(ol);
        resultsModal.classList.add('hidden'); // Esconde o modal de resultados da rodada, se estiver aberto
        finalRankingModal.classList.remove('hidden'); // Mostra o modal de ranking final
    });


    function renderResultsTable(data) {
         // Limpa a tabela anterior
         resultsTableContainer.innerHTML = '';

         // Cria a tabela
         const table = document.createElement('table');
         table.className = 'results-table';
 
         // Cabeçalho da tabela (Jogador, Categoria1, Categoria2..., Pontos)
         let headerHtml = '<thead><tr><th>Jogador</th>';
         data.categories.forEach(cat => headerHtml += `<th>${cat.charAt(0).toUpperCase() + cat.slice(1)}</th>`);
         headerHtml += '<th>Total</th></tr></thead>';
         table.innerHTML += headerHtml;
 
         // Corpo da tabela
         let bodyHtml = '<tbody>';
         data.playerResults.forEach(player => {
             bodyHtml += `<tr><td><strong>${player.name}</strong></td>`;
             data.categories.forEach(cat => {
                 const res = player.answers[cat];
                 let cellClass = '';
                 if (res.points === 5) cellClass = 'class="repeated-answer"';
                 if (res.invalidated) cellClass = 'class="invalidated-answer"';

                 // Adiciona o botão de invalidar apenas se o jogador for o líder e a resposta for válida
                 const invalidateButton = (isCurrentUserHost && res.points > 0 && res.answer)
                     ? `<span class="invalidate-btn" data-player-id="${player.id}" data-category="${cat}">❌</span>`
                     : '';
 
                 bodyHtml += `<td ${cellClass}>${res.answer} <span class="points">(${res.points})</span> ${invalidateButton}</td>`;
             });
             bodyHtml += `<td class="points">${player.totalRoundScore}</td></tr>`;
         });
         bodyHtml += '</tbody>';
         table.innerHTML += bodyHtml;
 
         resultsTableContainer.appendChild(table);

         // Adiciona os event listeners para os novos botões de invalidar
         document.querySelectorAll('.invalidate-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetPlayerId = e.target.dataset.playerId;
                const category = e.target.dataset.category;
                socket.emit('invalidateWord', { targetPlayerId, category });
            });
         });
    }

    // O servidor informa que o jogo foi reiniciado
    socket.on('gameRestarted', () => {
        resultsModal.classList.add('hidden'); // Esconde o modal se estiver aberto
        currentLetterDisplay.textContent = '?';
        
        // Reseta o timer para o valor selecionado no dropdown
        const selectedTime = timeOptionsSelect.value;
        const minutes = Math.floor(selectedTime / 60);
        const seconds = selectedTime % 60;
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        scoreDisplay.textContent = '0';
        categoryInputs.forEach(input => {
            input.value = '';
            input.disabled = true;
            input.classList.remove('input-correct', 'input-incorrect', 'invalid-word', 'duplicate-word');
        });
        timeOptionsSelect.disabled = false; // Habilita o seletor de tempo
    });

    // O servidor informa que a opção de tempo foi atualizada
    socket.on('serverUpdateTimeOption', (newTime) => {
        timeOptionsSelect.value = newTime;
    });
    
    // Alerta genérico para mensagens do servidor
    socket.on('serverMessage', (message) => {
        alert(message);
    });
});