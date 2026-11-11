/* Página sem conexão (arquivo próprio para funcionar com a política de segurança CSP). */
var btn = document.getElementById('retry');
if (btn) btn.addEventListener('click', function () { location.href = '/'; });
addEventListener('online', function () {
  document.getElementById('m').className = 'ok';
  document.getElementById('st').textContent = 'Conexão de volta. Abrindo a loja…';
  setTimeout(function () { location.href = '/'; }, 600);
});
