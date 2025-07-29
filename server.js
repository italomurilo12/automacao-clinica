// Importa os pacotes necessários
const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js'); // Importa o cliente Supabase

// Carrega as variáveis de ambiente do arquivo .env
dotenv.config();

// --- Inicializa o Cliente Supabase ---
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Carrega a Base de Conhecimento na memória
let knowledgeBaseText = '';
try {
    knowledgeBaseText = fs.readFileSync(path.join(__dirname, 'knowledge_base.md'), 'utf8');
    console.log("Base de conhecimento carregada com sucesso.");
} catch (error) {
    console.error("Erro ao carregar a base de conhecimento:", error);
    knowledgeBaseText = "Erro: A base de conhecimento não pôde ser carregada.";
}

// Inicializa o aplicativo Express
const app = express();
const port = 3000;

// Usa middlewares para processar JSON e servir arquivos estáticos
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Rota principal para servir o arquivo index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Define o endpoint da API para gerar o plano
app.post('/api/generate', async (req, res) => {
    const formData = req.body;
    let playbookText = ''; // Variável para armazenar o texto do playbook

    // --- 1. Geração do Plano com a API Gemini ---
    try {
        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (!geminiApiKey) throw new Error("A chave de API da Gemini não foi encontrada.");
        
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`;

        // --- PROMPT ATUALIZADO COM INSTRUÇÕES DE FORMATAÇÃO MAIS ESTRITAS ---
        const prompt = `
            Você é um consultor especialista em gestão e tecnologia de automação (com e sem IA) para clínicas odontológicas. Sua tarefa é criar um plano de ação prático detalhado e personalizado.

            **Use a Base de Conhecimento abaixo como inspiração para os tipos de soluções que você vai sugerir, mas não se limite a elas.**
            ---
            **Base de Conhecimento:**
            ${knowledgeBaseText}
            ---

            Agora, analise as respostas do usuário abaixo, combine-as com a base de conhecimento e crie o plano de ação.

            **Respostas do Usuário:**
            - **Áreas que mais consomem tempo:** ${formData.time_consumers}
            - **Nível de frustração com trabalho administrativo:** ${formData.frustration_level}
            - **Funcionalidade de IA com maior impacto desejado:** ${formData.biggest_impact}
            - **Tarefa que, se automatizada, melhoraria o equilíbrio vida/trabalho:** ${formData.work_life_balance_task}

            **Instruções para o Plano de Ação:**
            1.  **Diagnóstico Rápido:** Faça um diagnóstico rápido do problema do usuário, com base nas respostas anteriores e resuma as possíveis soluções combinando as respostas do usuário com a base de conhecimento.
            2.  **Seu Plano de Ação Prático:** Apresente um plano de ação prático e detalhado, dividido em etapas claras e fáceis de seguir. O plano deve ser personalizado para o problemas do usuários, com base nas respostas anteriores e na base de conhecimento. Divida o plano em 2 **Fases** e com **Prazo** sugerido, partindo das soluções mais simples até as mais complexas e apresentando o **Benefício** de cada etapa.
            
                        **Instruções Estritas de Formatação:**
            1.  **Títulos de Seção Principal:** Use SEMPRE '### ' (três hashtags e um espaço). Exemplo: '### Fase 1: Otimizações'.
            2.  **Subtítulos:** Use SEMPRE '#### ' (quatro hashtags e um espaço). Exemplo: '#### Ação 1.1: Lembretes Inteligentes'. NÃO use mais de quatro hashtags.
            3.  **Marcadores de Descrição:** Para itens como 'Descrição' ou 'Benefício', use **apenas texto em negrito**. Exemplo: '**Descrição:** Texto da descrição.'. NUNCA comece essas linhas com um asterisco (*) ou hífen (-).
            4.  **Listas de Itens:** Use ' * ' (um asterisco e um espaço) APENAS para listas de itens reais, como uma lista de tarefas.
            5.  **Separadores:** Use '---' em uma linha própria para criar uma divisão visual entre seções maiores.
         
            Mantenha a linguagem clara, encorajadora e profissional e não inclua citações de referência da base de conhecimento. Não faça menção da existência da base de conhecimento ou de qualquer fonte externa. Foque em fornecer um plano de ação prático e aplicável.
        `;
        
        const payload = { contents: [{ parts: [{ text: prompt }] }] };

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.text();
            throw new Error(`A requisição à API Gemini falhou com status ${geminiResponse.status}: ${errorBody}`);
        }

        const result = await geminiResponse.json();

        if (result.candidates && result.candidates.length > 0) {
            playbookText = result.candidates[0].content.parts[0].text;
        } else {
            throw new Error("Nenhum conteúdo foi gerado pela IA.");
        }

    } catch (aiError) {
        console.error('Erro na IA Gemini:', aiError);
        return res.status(500).json({ message: 'Erro ao gerar o plano com a IA.' });
    }

    // --- 2. Salva os dados no Supabase ---
    try {
        const { data, error } = await supabase
            .from('generated_playbooks') // Nome da sua tabela
            .insert([{ 
                user_name: formData.user_name,
                time_consumers: formData.time_consumers,
                frustration_level: formData.frustration_level,
                biggest_impact: formData.biggest_impact,
                work_life_balance_task: formData.work_life_balance_task,
                generated_playbook: playbookText // Salva o playbook gerado
            }]);

        if (error) {
            // Log do erro no console do servidor, mas não impede o usuário de ver o resultado
            console.error('Erro ao salvar no Supabase:', error);
        } else {
            console.log('Dados salvos no Supabase com sucesso:', data);
        }
    } catch (dbError) {
        console.error('Erro de conexão com o Supabase:', dbError);
    }
    
    // --- 3. Envia a resposta para o frontend ---
    res.json({ playbook: playbookText });
});

// Inicia o servidor
app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});
