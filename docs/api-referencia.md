# Referência da API

Todas as rotas ficam em `/api`, recebem e devolvem JSON e usam o cookie de sessão. 🔒 = exige login · 👑 = exige admin. `:slug` é o idioma (`english` ou `spanish`).

## Conta

| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/register` | Cadastro (nome, e-mail, senha) |
| POST | `/auth/login` | Login com e-mail e senha |
| POST | `/auth/forgot` | Envia o link de redefinição (resposta sempre igual) |
| POST | `/auth/reset` | Nova senha com o token do e-mail |
| POST | `/auth/logout` | Encerra a sessão |
| GET | `/auth/me` 🔒 | Usuário logado |
| GET | `/auth/options` | Se o login com Google está disponível |
| GET | `/auth/google` → `/auth/google/callback` | Login com Google (OAuth) |
| PATCH | `/auth/prefs` 🔒 | Relatório por e-mail e horário do lembrete |
| GET/POST/DELETE | `/push/key`, `/push/subscribe` 🔒 | Lembrete por notificação |
| GET/POST | `/email/unsubscribe?t=` | Descadastro do relatório semanal |

## Idioma e progresso

| Método | Rota | Descrição |
|---|---|---|
| GET | `/meta` | Idiomas, temas, cenários e professores |
| GET | `/languages/:slug/dashboard` 🔒 | Painel: nível, metas, foco do dia, erros, conquistas |
| POST | `/languages/:slug/enroll` 🔒 | Configura o idioma (nível, objetivo, estilo) |
| PATCH | `/languages/:slug/profile` 🔒 | Ajusta perfil, metas e professor |
| POST | `/languages/:slug/placement` 🔒 | Começa o nivelamento |
| POST | `/placement/:id/answer` 🔒 | Responde uma pergunta do nivelamento |
| GET | `/languages/:slug/report` 🔒 | Relatório dos últimos 7 dias |

## Aulas e conversas

| Método | Rota | Descrição |
|---|---|---|
| POST | `/languages/:slug/lessons` 🔒 | Nova aula (`lesson`, `daily`, `words`) |
| GET | `/lessons/:id` 🔒 | Estado da aula e mensagens |
| POST | `/lessons/:id/answer` 🔒 | Envia uma resposta |
| POST | `/languages/:slug/conversations` 🔒 | Conversa guiada ou roleplay por texto |
| POST | `/conversations/:id/message` 🔒 | Fala na conversa |
| POST | `/conversations/:id/finish` 🔒 | Encerra e gera o relatório final |
| GET | `/voice/remaining` 🔒 | Minutos de voz restantes hoje |
| POST | `/languages/:slug/live` 🔒 | Cria a conversa por voz |
| WS | `/live/:id` 🔒 | Áudio em tempo real (ver [voz-ao-vivo.md](voz-ao-vivo.md)) |
| GET/POST | `/languages/:slug/tutor`, `/tutor/:id/message` 🔒 | Chat livre (texto e imagem) |

## Prática

| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `/languages/:slug/vocabulary` 🔒 | Lista / adiciona palavra (a IA completa tradução e pronúncia) |
| PATCH/DELETE | `/languages/:slug/vocabulary/:id` 🔒 | Marca como difícil / remove |
| GET | `/languages/:slug/vocabulary/review` 🔒 | Flashcards vencidos |
| POST | `/languages/:slug/vocabulary/:id/review` 🔒 | Resultado da revisão (SRS) |
| POST | `/languages/:slug/pronunciation/assess` 🔒 | Áudio gravado → nota e sons a melhorar |
| POST | `/languages/:slug/listening/check` 🔒 | Confere o ditado |
| GET | `/languages/:slug/tts?text=` 🔒 | Frase falada pela voz do professor (com cache) |
| POST | `/languages/:slug/materials` 🔒 | Foto ou PDF do exercício |
| POST | `/languages/:slug/materials/:id/lesson` 🔒 | Aula a partir do material |

## Administração 👑

| Método | Rota | Descrição |
|---|---|---|
| GET | `/admin/overview` | Usuários, quem está online e em aula por voz |
| GET | `/admin/users/:id` | Detalhes, uso da IA e atividades |
| PATCH | `/admin/users/:id` | Bloquear, tornar admin, limite de voz |
| POST | `/admin/users/:id/password` | Define nova senha (encerra as sessões da pessoa) |
| DELETE | `/admin/users/:id` | Exclui a conta e o progresso |
| GET | `/admin/usage?days=30` | Custos por dia, por usuário e por modelo, erros de cota |
