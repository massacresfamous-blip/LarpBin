const express = require('express');
const router = express.Router();

const pages = {
    '/faq': {
        title: 'FAQ',
        description: 'Answers to common questions about using BreachBin.',
        sections: [
            {
                question: 'How do I create a paste?',
                answer: 'Choose New Paste from the navigation, add your title and content, then submit the form.'
            },
            {
                question: 'How do I find a paste or user?',
                answer: 'Use Search and choose whether to search pastes or users.'
            },
            {
                question: 'What does pinning a paste mean?',
                answer: 'Pinned pastes are highlighted separately and shown before regular pastes. Pinning is managed by site administrators.'
            },
            {
                question: 'How do profile images work?',
                answer: 'You can update your profile image and banner from your profile when signed in. Animated profile images are available to accounts with a role other than Member.'
            },
            {
                question: 'Can I purchase an upgrade?',
                answer: 'The Wealthy and Colors upgrades are listed for $1.00 each. Stripe checkout has not been configured yet, so purchases are not available.',
                link: { href: '/buy', label: 'View the upgrade shop' }
            }
        ]
    },
    '/prices': {
        title: 'Prices',
        description: 'Wealthy: $1.00. Colors: $1.00. Stripe checkout has not been configured yet, so these upgrades cannot currently be purchased.',
        shopLink: true
    },
    '/donate': {
        title: 'Donations',
        description: 'Online donations are not currently enabled. Do not send payment to anyone claiming to collect donations on behalf of BreachBin.'
    },
    '/contact': {
        title: 'Contact',
        description: 'For questions about the site, contact the BreachBin community through the official Telegram link below.',
        contact: true
    },
    '/terms': {
        title: 'Terms of Service',
        description: 'The Terms of Service are not currently published on this site. Please check back later for the official terms.'
    },
    '/changelog': {
        title: 'Changelog',
        description: 'A changelog is not currently published on this site.'
    }
};

router.get('/', (req, res) => {
    const pagePath = req.baseUrl.replace(/\.php$/, '');
    const page = pages[pagePath];

    if (!page) {
        return res.status(404).send('Page not found');
    }

    res.render('pages/info', { page });
});

module.exports = router;
