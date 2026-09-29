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
Hoje o cliente escolhe Pix ou cartão e o pedido vai por WhatsApp; a loja envia a chave Pix/QR Code ou o link de pagamento. Cobrança automática dentro do site exige um provedor (ex.: Mercado Pago, que aceita Pix e cartão) com conta da loja e um pequeno servidor para guardar a chave secreta.

## Painel do cliente (`/painel/`)
Entra com e-mail e senha (Firebase Authentication). Só o e-mail listado em `firestore.rules` e em `painel/painel.js` (`ADMINS`) altera o catálogo.

## Segurança
- **Regras do Firestore** (`firestore.rules`): leitura pública só do catálogo; escrita só do administrador, com validação de formato; cada cliente lê apenas os próprios cupons. Ao mudar o arquivo, cole o conteúdo em Firestore Database → Regras → Publicar.
- **Painel:** sessão termina ao fechar a aba e após 20 min parado; 5 senhas erradas bloqueiam o login por um tempo; conta que não é administradora é desconectada.
- **Cabeçalhos** (`vercel.json`): o painel roda com Content-Security-Policy restritiva, sem cache, sem indexação e não pode ser aberto dentro de outro site; a loja bloqueia iframe e sniffing.
- **Cupom COMPARTILHE10:** o servidor não consegue confirmar que a loja foi compartilhada; as regras garantem 10%, um por conta, e que só pode ser marcado como usado.
- **Chave da API (recomendado):** no Google Cloud Console → APIs e serviços → Credenciais → chave "Browser key" → Restrições de aplicativo → Referenciadores HTTP: `clouts-loja.vercel.app/*` (e o domínio próprio).
