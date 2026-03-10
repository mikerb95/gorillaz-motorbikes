const mongoose = require('mongoose');

const EnrollmentSchema = new mongoose.Schema({
    id: { type: String, required: true },
    courseId: { type: String, required: true },
    classId: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
    date: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Enrollment', EnrollmentSchema);
