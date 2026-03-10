const mongoose = require('mongoose');

const CourseSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    shortDescription: { type: String },
    longDescription: { type: String },
    image: { type: String, default: '/images/services/curso.webp' },
    duration: { type: String },
    price: { type: Number },
    benefits: [String],
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Course', CourseSchema);