# CLOUTS — loja online

Abra `index.html` para ver a loja (funciona direto no computador; o login Google só funciona depois de publicada, veja abaixo).

## Arquivos
- `index.html`, `style.css`, `app.js` — a loja
- `products.js` — produtos, códigos, preços (`preco: 0`) e a lista `MAIS_VENDIDOS`
- `auth.js` — login com Google (Firebase)
- `img/` — logo (`logo.png`, original sem alteração) e fotos dos produtos
- `_originais/` — imagens brutas extraídas dos catálogos (não são usadas pelo site)

## O que editar
| O quê | Onde |
|---|---|
| Preço de uma peça | `products.js` → `preco` |
| WhatsApp / Instagram | `app.js` → `CONFIG.whatsapp`, `CONFIG.instagram` (hoje 55 31 99481-0359 e @clouts.oficial) |
| Valor do frete por cidade | `app.js` → `CONFIG.frete` (hoje R$ 0,00) |
| Frete grátis acima de X | `app.js` → `CONFIG.freteGratisAcima` |
| Mais vendidos | `products.js` → `MAIS_VENDIDOS` |

## Ativar o login com Google (falta você fazer)
1. Acesse https://console.firebase.google.com e crie um projeto (ex.: `clouts`).
2. **Authentication → Método de login → Google → Ativar.**
3. **Configurações do projeto → Seus apps → Web (`</>`)**, registre o app e copie o `firebaseConfig`.
4. Cole em `auth.js` no lugar de `const FIREBASE_CONFIG = null;`.
5. **Authentication → Configurações → Domínios autorizados:** adicione o domínio onde o site ficar.
Sem isso o botão mostra um aviso e o site funciona sem login. Depois de ativado, o cliente precisa entrar com o Google para finalizar o pedido.

## Frete
Ao informar o CEP, o site consulta o ViaCEP, confirma se é Contagem, Betim ou Belo Horizonte e aplica o valor de `CONFIG.frete`. CEP de outras cidades é recusado.

## Pagamento (Pix e cartão)
Enquanto `CONFIG.pagamentoOnline` (em `app.js`) for `false`, o pedido vai por WhatsApp. O pagamento online com **Mercado Pago (Pix e cartão)** já está programado em `api/checkout.js` e `api/webhook.js`: o servidor recalcula preço, estoque, cupom e frete (o navegador não consegue alterar valores), cria o link de pagamento e só marca o pedido como pago quando o Mercado Pago confirma. Para ligar:

1. **Preços:** defina os preços no painel (hoje são R$ 0; o servidor recusa peça sem preço) e o frete em `api/_lib.js` (`FRETE`) e em `CONFIG.frete`.
2. **Mercado Pago:** painel de desenvolvedores → Suas integrações → criar aplicação (Checkout Pro) → credenciais de **produção** → copiar o *Access Token*. Em Webhooks, configurar a URL `https://SEU-SITE/api/webhook` (evento "Pagamentos") e copiar a *Assinatura secreta*.
3. **Firebase:** Configurações do projeto → Contas de serviço → "Gerar nova chave privada" (baixa um .json).
4. **Vercel → Settings → Environment Variables** (nunca no GitHub): `MP_ACCESS_TOKEN`, `FIREBASE_SERVICE_ACCOUNT` (conteúdo inteiro do .json), `SITE_URL` (ex.: `https://clouts-loja.vercel.app`) e `MP_WEBHOOK_SECRET`. Depois, Redeploy.
5. **Regras do Firestore** (indicação só após compra paga): em `firestore.rules`, no bloco `match /referrals/{refUid}`, apague os `allow create` e `allow update` e o `allow create` de `convidados` (deixe só os `allow read`); o servidor passa a gravar. Publique.
6. Em `app.js`, mude `pagamentoOnline` para `true`, faça uma compra de teste de valor baixo e confira em Firebase → `pedidos` o status `pago`.

Antes de ligar, teste com as credenciais de **teste** do Mercado Pago.

## Painel do cliente (`/painel/`)
Entra com a **conta Google do administrador** (sem senha própria do painel), então vale a verificação em duas etapas da conta Google: myaccount.google.com → Segurança → Verificação em duas etapas (de preferência com chave de acesso/passkey ou app autenticador). Só o e-mail listado em `firestore.rules` e em `painel/painel.js` (`ADMINS`) altera o catálogo.
Depois de entrar pelo Google com sucesso, desligue o login por e-mail/senha: Firebase → Authentication → Método de login → E-mail/senha → Desativar (e apague o usuário de senha em Usuários).

## Segurança
- **Regras do Firestore** (`firestore.rules`): leitura pública só do catálogo; escrita só do administrador, com validação de formato; cada cliente lê apenas os próprios cupons. Ao mudar o arquivo, cole o conteúdo em Firestore Database → Regras → Publicar.
- **Painel:** sessão termina ao fechar a aba e após 20 min parado; só a conta Google do administrador (e-mail verificado) entra; qualquer outra conta é desconectada.
- **Cabeçalhos** (`vercel.json`): loja e painel têm Content-Security-Policy (só scripts do próprio site, Firebase/Google e ViaCEP), HSTS, sem iframe e sem sniffing; o painel ainda não usa cache nem é indexado. Se um dia adicionar um serviço externo (ex.: Mercado Pago no navegador), libere o endereço dele na CSP.
- **Sair da conta:** apaga do aparelho o carrinho, o endereço e os dados do cliente.
- **Cupom de indicação:** as regras limitam a um cupom por conta, com degrau 5/10/20% conforme os amigos contados. Contas Google falsas ainda podem inflar a contagem; o fechamento definitivo é contar o amigo só depois da primeira compra paga (exige o pagamento integrado, veja `api/` e a seção Pagamento).
- **App Check (recomendado):** Firebase → App Check → Apps → registrar o app web com reCAPTCHA v3 → copiar a chave do site para `APPCHECK_SITE_KEY` em `auth.js` e `painel/painel.js` → publicar → só então clicar em "Impor" (Enforce) para Firestore e Authentication.
- **Chave da API (recomendado):** no Google Cloud Console (projeto clouts-409b7) → APIs e serviços → Credenciais → chave "Browser key" → Restrições de aplicativo → Sites (referenciadores HTTP): `https://clouts-loja.vercel.app/*`, `https://clouts-409b7.firebaseapp.com/*` e, se usar, `http://localhost:5173/*` e o domínio próprio. Em "Restrições de API", deixe só as APIs do Firebase usadas (Identity Toolkit, Token Service, Cloud Firestore, Firebase App Check).

## E-mails automáticos (boas-vindas, pedido, carrinho abandonado)

Rotas: `api/email.js` (disparos), `api/cron.js` (lembrete de carrinho, 1x por dia), `api/descadastrar.js` (link "parar de receber"). Modelos visuais em `api/_mail.js`.
Variáveis na Vercel (Settings → Environment Variables), depois **Redeploy**:
- `FIREBASE_SERVICE_ACCOUNT` e `SITE_URL` (as mesmas do pagamento)
- Envio, UMA das opções: Gmail (`GMAIL_USER` + `GMAIL_APP_PASSWORD`, senha de app de 16 letras) **ou** Resend (`RESEND_API_KEY` + `MAIL_FROM`, exige domínio verificado)
- `CRON_SECRET` (texto aleatório longo)
Sem essas variáveis os e-mails simplesmente não saem e a loja funciona normal.
