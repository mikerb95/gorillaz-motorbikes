const mongoose = require('mongoose');

const EventSchema = new mongoose.Schema({
    id: { type: String, required: true },
    title: { type: String, required: true },
    date: { type: String, required: true },
    location: { type: String },
    description: { type: String },
    level: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Event', EventSchema);
