require('dotenv').config();
const mongoose = require('mongoose');

async function testConnection() {
  try {
    console.log('Connecting to: ', process.env.MONGO_URI ? 'URI present in .env' : 'No URI found!');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected successfully to MongoDB!');
    
    // Test write/read
    const TestSchema = new mongoose.Schema({ name: String });
    const TestModel = mongoose.models.Test || mongoose.model('Test', TestSchema);
    
    const doc = new TestModel({ name: 'Connection Test' });
    await doc.save();
    console.log('✅ Document written successfully!');
    
    await TestModel.deleteOne({ _id: doc._id });
    console.log('✅ Document deleted successfully!');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Connection error:', err.message);
    process.exit(1);
  }
}
testConnection();
