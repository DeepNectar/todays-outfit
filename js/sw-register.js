/* Register the service worker (only on https / localhost — required by browsers). */
(function () {
    'use strict';
    if ('serviceWorker' in navigator &&
        (window.isSecureContext || location.hostname === 'localhost')) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/sw.js').catch(function (err) {
                console.warn('SW registration failed:', err);
            });
        });
    }
})();
