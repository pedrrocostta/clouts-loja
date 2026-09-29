/* Catálogo CLOUTS — preços zerados por enquanto. Para definir um preço, altere o campo "preco" (em reais). */
const F = (cod, modelo, lycra, extra = {}) => ({
  id: 'f-' + cod, cod, secao: 'feminino', modelo, nome: `Calça ${modelo} ${cod}`,
  lycra, tam: ['36', '38', '40', '42', '44', '46'], preco: 0, img: `img/produtos/f-${cod}.jpg`, ...extra
});
const M = (n, nome, cor, tecido, tam) => ({
  id: 'm-' + n, cod: 'CLM-' + String(n).padStart(3, '0'), secao: 'masculino', modelo: 'Slim Fit',
  nome: `${nome} (Slim Fit)`, cor, tecido, tam, preco: 0,
  img: `img/produtos/m-${n}.jpg`, extras: [`img/produtos/m-${n}-d1.jpg`, `img/produtos/m-${n}-d2.jpg`]
});

const PRODUTOS = [
  F('112466-1', 'Cigarrete', 3), F('112725-1', 'Cigarrete', 2), F('112552-1', 'Cigarrete', 2),
  F('112541-1', 'Cigarrete', 3), F('112801-2', 'Cigarrete', 2), F('112425-1', 'Wide Leg', 1, { premium: true }),
  F('111366-2', 'Cigarrete', 3, { premium: true }), F('111664-1', 'Moom', 1, { premium: true }),
  F('111879-1', 'Cigarrete', 3), F('112236-1', 'Wide Leg', 1, { premium: true }),
  F('112271-1', 'Wide Leg', 2, { premium: true }), F('112420-1', 'Wide Leg', 2, { premium: true }),
  F('112866-1', 'Jaqueta', 1, { nome: 'Jaqueta Jeans 112866-1' }), F('112345-2', 'Cigarrete', 3),
  F('112136-1', 'Wide Leg', 2, { premium: true }), F('112244-1', 'Wide Leg', 1, { premium: true }),
  F('112406-1', 'Wide Leg', 2, { premium: true }), F('112247-1', 'Wide Leg', 1, { premium: true }),
  F('112144-1', 'Wide Leg', 2, { diamond: true }), F('113064-1', 'Jaqueta', 1, { nome: 'Jaqueta Jeans 113064-1' }),
  F('113432-2', 'Moom', 1, { premium: true }), F('112710-1', 'Cigarrete', 2),
  F('112828-M', 'Wide Leg', 2, { diamond: true, nome: 'Calça Wide Leg Cargo 112828-M' }),
  F('112960-1', 'Wide Leg', 2, { diamond: true, nome: 'Calça Cargo Diamond 112960-1' }),
  F('113238-1', 'Boot Cut', 4), F('113165-1', 'Wide Leg', 2, { premium: true }),
  F('VL001', 'Cigarrete', null, { nome: 'Calça Cigarrete Preto Essencial VL001' }),
  M(1, 'Calça Barcelona', 'Nardo Grey', 'Poliviscose com elastano', ['38', '40', '42', '44', '46']),
  M(2, 'Calça Berlim', 'Palha', 'Sarja cetim com elastano', ['38', '40', '42', '44', '46', '48']),
  M(3, 'Calça Berlim', 'Bege', 'Sarja cetim com elastano', ['38', '40', '42', '44', '46', '48']),
  M(4, 'Calça Berlim', 'Grafite', 'Sarja cetim com elastano', ['38', '40', '42', '44', '46', '48']),
  M(5, 'Calça Berlim', 'Preta', 'Sarja cetim com elastano', ['38', '40', '42', '44', '46', '48']),
  M(6, 'Calça Berlim', 'Marinho', 'Sarja cetim com elastano', ['38', '40', '42', '44', '46', '48'])
];

/* Mais vendidos — lista editável (ids das peças, na ordem de exibição). Ajuste conforme suas vendas reais. */
const MAIS_VENDIDOS = ['f-112466-1', 'm-1', 'f-112420-1', 'f-112271-1', 'm-5', 'f-112725-1', 'f-111664-1', 'm-3', 'f-112425-1', 'f-112345-2', 'm-6', 'f-VL001', 'm-4', 'f-112236-1', 'm-2', 'f-113432-2'];
