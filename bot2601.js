// Autor: Daniel Lima da Paz
// Chatbot WhatsApp CISPN/SENASP - Versão 4.0.7 (Suporte @lid)
// Lógica: Correção Race Condition + Sessão 3h + Heartbeat Server + Bloqueio Status + Suporte @lid

const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const http = require('http');

// ==========================================
// 1. CONFIGURAÇÕES E ESTADOS
// ==========================================

const CONFIG = {
    sessionName: 'cispn-session',
    headless: 'new', 
    timeouts: {
        sessionExpiry: 3 * 60 * 60 * 1000 
    },
    heartbeatPort: 9090
};

const sessoes = new Map();

const MENU_DATA = [
    { id: '1', title: 'RESPAD – Centro de Resposta em Ações Integradas para Atuação em Situações de Desastres' },
    { id: '2', title: 'VIPS – Centro Integrado de Operações de Combate à Violência contra as Pessoas Vulnerabilizadas' },
    { id: '3', title: 'CICCN – Centro Integrado de Comando e Controle Nacional' },
    { id: '4', title: 'CISPPA – Centro Integrado de Segurança Pública e Proteção Ambiental' },
    { id: '5', title: 'COPTEC – Centro de Operações de Proteção ao Torcedor e Eventos Culturais' },
    { id: '6', title: 'Outra situação' }
];

// ==========================================
// 2. SERVIDOR DE DIAGNÓSTICO (HEARTBEAT)
// ==========================================
const heartbeatServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Online');
});

heartbeatServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ [AVISO] Porta ${CONFIG.heartbeatPort} já em uso. Continuando sem servidor de monitoramento...`);
    } else {
        console.error('❌ [ERRO] Servidor Heartbeat:', err);
    }
});

heartbeatServer.listen(CONFIG.heartbeatPort, () => {
    console.log(`💓 [SISTEMA] Heartbeat Server rodando na porta ${CONFIG.heartbeatPort}`);
});

// ==========================================
// 3. INICIALIZAÇÃO DO WHATSAPP
// ==========================================

wppconnect.create({
    session: CONFIG.sessionName,
    catchQR: (base64Qr) => {
        const matches = base64Qr.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            fs.writeFileSync('qrcode.png', Buffer.from(matches[2], 'base64'));
        }
        console.log('📱 QR Code gerado. Verifique o terminal ou qrcode.png');
    },
    headless: CONFIG.headless,
    browserArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
})
.then((client) => start(client))
.catch((error) => console.log('❌ [ERRO CRÍTICO]', error));

// ==========================================
// 4. LÓGICA PRINCIPAL
// ==========================================

async function start(client) {
    console.log('✅ Bot CISPN/SENASP Iniciado e Pronto para Receber Mensagens!');
    console.log('🔍 [DEBUG] Aguardando mensagens...\n');

    client.onMessage(async (message) => {
        try {
            console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('📨 [MENSAGEM RECEBIDA]');
            console.log('De:', message.from);
            console.log('Texto:', message.body);
            console.log('É Grupo?', message.isGroupMsg);
            console.log('É Minha?', message.fromMe);
            console.log('ChatId:', message.chatId);
            console.log('Type:', message.type);
            
            // ========================================
            // FILTROS DE SEGURANÇA CRÍTICOS
            // ========================================
            
            // 1. Ignora grupos
            if (message.isGroupMsg) {
                console.log('🚫 [BLOQUEADO] Mensagem de grupo ignorada');
                return;
            }
            
            // 2. Ignora mensagens enviadas pelo próprio bot
            if (message.fromMe) {
                console.log('🚫 [BLOQUEADO] Mensagem própria ignorada');
                return;
            }
            
            // 3. BLOQUEIO DE STATUS DO WHATSAPP
            if (message.from.includes('@broadcast')) {
                console.log('🚫 [BLOQUEADO] Mensagem de status ignorada (broadcast)');
                return;
            }
            
            // 4. Bloqueio adicional via chatId
            if (message.chatId && message.chatId.includes('status')) {
                console.log('🚫 [BLOQUEADO] Status detectado via chatId');
                return;
            }
            
            // 5. Aceita mensagens de contatos individuais (@c.us OU @lid)
            // @c.us = WhatsApp pessoal
            // @lid = WhatsApp Business / Novos formatos
            const isValidContact = message.from.endsWith('@c.us') || message.from.endsWith('@lid');
            
            if (!isValidContact) {
                console.log('🚫 [BLOQUEADO] Formato de contato inválido:', message.from);
                return;
            }

            console.log('✅ [APROVADO] Mensagem válida! Processando...');

            // ========================================
            // PROCESSAMENTO NORMAL
            // ========================================
            
            const user = message.from;
            const texto = (message.body || '').trim();
            const agora = Date.now();

            // Cria sessão se não existir
            if (!sessoes.has(user)) {
                console.log('🆕 [SESSÃO] Criando nova sessão para:', user);
                criarSessao(user);
            }
            
            const sessao = sessoes.get(user);
            console.log('📊 [SESSÃO] Estado atual:', sessao.step);

            // Verificação de expiração
            if (agora - sessao.lastInteraction > CONFIG.timeouts.sessionExpiry) {
                console.log(`🔄 [SESSÃO] Sessão expirou (3h). Reiniciando...`);
                resetarSessao(user);
            } else {
                sessao.lastInteraction = agora;
            }
            
            // MÁQUINA DE ESTADOS
            
            if (sessao.step === 'ATENDIMENTO_CONCLUIDO') {
                console.log('⏹️ [SESSÃO] Atendimento já concluído. Ignorando mensagem.');
                return;
            }

            if (sessao.step === 'MENU') {
                console.log('📋 [AÇÃO] Enviando menu inicial...');
                sessao.step = 'ENVIANDO_MENU'; 
                await processarInicio(client, user, texto, sessao);
                console.log('✅ [AÇÃO] Menu enviado com sucesso!');
                return; 
            }

            if (sessao.step === 'ENVIANDO_MENU') {
                console.log('⏳ [AGUARDANDO] Menu sendo enviado. Ignorando mensagem.');
                return;
            }

            if (sessao.step === 'AGUARDANDO_SELECAO') {
                console.log('🔢 [AÇÃO] Processando seleção de opção...');
                const opcao = extrairOpcao(texto);
                
                if (opcao) {
                    const areaObj = MENU_DATA.find(o => o.id === opcao);
                    sessao.data.area = areaObj ? areaObj.title : `Opção ${opcao}`;
                    sessao.step = 'AGUARDANDO_DETALHES';
                    
                    console.log('✅ [SELEÇÃO] Opção válida:', opcao);
                    await client.sendText(user, 
                        `*Área selecionada:* ${sessao.data.area}\n\n` + 
                        `Certo! Agora, por gentileza, nos diga como podemos ajudar.`);
                    console.log('✅ [AÇÃO] Confirmação de área enviada!');
                } else {
                    console.log('❌ [SELEÇÃO] Opção inválida:', texto);
                    await client.sendText(user, "Por favor, digite apenas o número correspondente à opção desejada (1 a 6).");
                }
                return;
            }

            if (sessao.step === 'AGUARDANDO_DETALHES') {
                console.log(`📝 [RELATO] Usuário ${user} enviou: ${texto}`);
                sessao.step = 'ATENDIMENTO_CONCLUIDO';
                
                await client.sendText(user, "Agradecemos a mensagem. Em breve, alguém da nossa equipe entrará em contato.");
                console.log('✅ [FINALIZADO] Atendimento concluído!');
                return;
            }

            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        } catch (error) {
            console.error('❌ [ERRO] Erro ao processar mensagem:', error);
        }
    });
}

// ==========================================
// 5. FUNÇÕES AUXILIARES
// ==========================================

async function processarInicio(client, user, texto, sessao) {
    const saudacao = obterSaudacao(); 
    sessao.data.saudacao = saudacao;

    const menu = 
        `${saudacao}! O CISPN/SENASP agradece o seu contato. Como podemos ajudar? Escolha a área e responda com o número correspondente:\n\n` +
        `1️⃣ RESPAD – Centro de Resposta em Ações Integradas para Atuação em Situações de Desastres\n\n` +
        `2️⃣ VIPS – Centro Integrado de Operações de Combate à Violência contra as Pessoas Vulnerabilizadas\n\n` +
        `3️⃣ CICCN – Centro Integrado de Comando e Controle Nacional\n\n` +
        `4️⃣ CISPPA – Centro Integrado de Segurança Pública e Proteção Ambiental\n\n` +
        `5️⃣ COPTEC – Centro de Operações de Proteção ao Torcedor e Eventos Culturais\n\n` +
        `6️⃣ Outra situação`;

    await client.sendText(user, menu);
    sessao.step = 'AGUARDANDO_SELECAO';
}

function criarSessao(user) {
    sessoes.set(user, {
        step: 'MENU',
        lastInteraction: Date.now(),
        data: { area: '', saudacao: '' }
    });
}

function resetarSessao(user) {
    criarSessao(user);
}

function obterSaudacao() {
    const hora = new Date().getHours();
    if (hora < 12) return 'Bom dia';
    else if (hora < 18) return 'Boa tarde';
    else return 'Boa noite';
}

function extrairOpcao(texto) {
    const match = texto.match(/\b([1-6])\b/);
    return match ? match[1] : null;
}

// ==========================================
// 6. TRATAMENTO DE ENCERRAMENTO
// ==========================================

process.on('SIGINT', () => {
    console.log('\n🛑 [SISTEMA] Encerrando bot graciosamente...');
    heartbeatServer.close(() => {
        console.log('💓 [SISTEMA] Heartbeat Server encerrado');
        process.exit(0);
    });
});