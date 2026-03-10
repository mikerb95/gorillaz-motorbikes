
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, default: 'user' },
  membership: {
    level: { type: String },
    since: { type: String },
    expires: { type: String },
    benefits: [String]
  },
  visits: [{
    date: { type: String },
    service: { type: String }
  }],
  vehicles: [{
    plate: { type: String },
    soatExpires: { type: String },
    tecnoExpires: { type: String }
  }]
});

module.exports = mongoose.model('User', UserSchema);
