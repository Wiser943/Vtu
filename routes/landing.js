const express = require('express');
const router = express.Router();
const { loadUser } = require('../middleware/auth');

router.use(loadUser);

router.get('/', (req, res) => {
  if (req.session.userId) {
    const role = req.session.userRole || 'user';
    return res.redirect(`/${role}/dashboard`);
  }
  res.render('landing', { title: 'NairaFlow — Buy Data, Airtime & Pay Bills Instantly' });
});

module.exports = router;
