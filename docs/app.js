// qai Demo Site - JavaScript
// This file contains intentional bugs for QA testing

document.addEventListener('DOMContentLoaded', function () {
  // BUG: Referencing undefined variable causes console error
  console.log('Demo site loaded');
  console.log('Config:', siteConfig); // ReferenceError: siteConfig is not defined

  // CTA Button click handler
  const ctaBtn = document.getElementById('cta-btn');
  if (ctaBtn) {
    ctaBtn.addEventListener('click', function () {
      // BUG: Alert is not accessible and annoying
      alert('Thanks for clicking! This is a demo site.');
    });
  }

  // Form submission handler
  const form = document.getElementById('contact-form');
  const statusEl = document.getElementById('form-status');

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      const name = document.getElementById('name').value;
      const email = document.getElementById('email').value;
      const message = document.getElementById('message').value;

      // BUG: No client-side validation before "sending"
      // BUG: Race condition - status shows before "processing" completes
      statusEl.textContent = 'Sending...';
      statusEl.className = 'form-status';

      // Simulate API call
      setTimeout(function () {
        // BUG: Always succeeds, never validates email format
        if (name && email && message) {
          statusEl.textContent = 'Message sent successfully!';
          statusEl.className = 'form-status success';
          form.reset();
        } else {
          // BUG: Generic error message doesn't tell user what's missing
          statusEl.textContent = 'Error: Please fill out the form.';
          statusEl.className = 'form-status error';
        }
      }, 1000);
    });
  }

  // Buy button handlers
  const buyButtons = document.querySelectorAll('.buy-btn');
  buyButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!btn.disabled) {
        // BUG: Uses deprecated API
        const plan = btn.parentElement.querySelector('h3').innerText;
        console.log('Selected plan:', plan);

        // BUG: Another console error - undefined function
        trackPurchase(plan); // ReferenceError: trackPurchase is not defined
      }
    });
  });

  // Mobile nav toggle
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (navToggle) {
    navToggle.addEventListener('click', function () {
      // BUG: Toggle doesn't actually work - CSS hides nav-links on mobile with no toggle class
      navLinks.classList.toggle('active');
      console.log('Nav toggled, but CSS does not support this');
    });
  }

  // BUG: Scroll event listener without throttling (performance issue)
  window.addEventListener('scroll', function () {
    const scrollPos = window.scrollY;
    // Doing unnecessary work on every scroll event
    document.querySelectorAll('.feature-card').forEach(function (card, index) {
      card.style.opacity = Math.min(1, scrollPos / 500 + 0.5);
    });
  });

  // BUG: Set timeout that logs after page might be navigated away
  setTimeout(function () {
    console.log('Delayed analytics ping');
    // BUG: Trying to call undefined analytics
    analytics.track('page_view_delayed'); // ReferenceError
  }, 5000);
});

// BUG: Global error handler that swallows errors (bad practice)
window.onerror = function (msg, url, lineNo, columnNo, error) {
  console.log('Error caught:', msg);
  // BUG: Returns true which prevents error from being logged to console properly
  // return true; // Uncomment to hide all errors (worse bug)
  return false;
};
