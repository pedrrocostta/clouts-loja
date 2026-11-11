/* Tela de carregamento: avisos de conexão lenta. Fica em arquivo próprio para a política de segurança (CSP) não precisar liberar scripts dentro do HTML. */
setTimeout(function () { var e = document.getElementById('spSlow'); if (e && document.getElementById('splash')) e.hidden = false; }, 6000);
setTimeout(function () { var b = document.getElementById('spRetry'); if (b && document.getElementById('splash')) { b.hidden = false; b.onclick = function () { location.reload(); }; } }, 14000);
