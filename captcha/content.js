(function () {
    function fillCaptcha() {
        const captcha = document.getElementById("captcha");
        const input = document.getElementById("textBox");

        if (!captcha || !input) return;

        const value = captcha.textContent.trim();

        if (!value) return;

        if (input.value !== value) {
            input.value = value;

            // Make sure any site's JS listeners notice the change
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }
    }

    // Initial fill
    fillCaptcha();

    // Detect CAPTCHA refresh/change
    const observer = new MutationObserver(() => {
        fillCaptcha();
    });

    const captcha = document.getElementById("captcha");

    if (captcha) {
        observer.observe(captcha, {
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    // Small fallback for dynamically generated CAPTCHA
    setInterval(fillCaptcha, 500);
})();