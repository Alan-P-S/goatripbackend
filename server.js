require("dotenv").config()

const express = require("express")
const multer = require("multer")
const cloudinary = require("cloudinary").v2
const mysql = require("mysql2")
const cors = require("cors")
const { Http2ServerRequest } = require("http2")
const cron = require("node-cron");
const https = require("https");
const http = require('http');
const {Server} = require('socket.io');


const app = express()
const server = http.createServer(app);
const io = new Server(server);

app.set('view engine','ejs');
const allowedOrigins = ['http://localhost:3000','http://localhost:5173' ,'https://ctgoa.netlify.app']; // Replace with your actual client URLs

const corsOptions = {
  origin: allowedOrigins
};

cron.schedule("*/5 * * * *",()=>{
   https.get("https://goatripbackend.onrender.com");
   console.log("Pinged to keep alive");
})
app.use(cors(corsOptions));
app.use(express.json())

/* -----------------------------
   Validate ENV variables
----------------------------- */

const requiredEnv = [
"DB_HOST",
"DB_USER",
"DB_NAME",
"CLOUD_NAME",
"CLOUD_API_KEY",
"CLOUD_API_SECRET",
"PORT"
]

requiredEnv.forEach(env=>{
if(!process.env[env]){
console.error(`❌ Missing ENV variable: ${env}`)
process.exit(1)
}
})

/* -----------------------------
   MySQL Connection
----------------------------- */

const db = mysql.createPool({
host: process.env.DB_HOST,
user: process.env.DB_USER,
password: process.env.DB_PASSWORD,
database: process.env.DB_NAME
})



/* -----------------------------
   Cloudinary Config
----------------------------- */

cloudinary.config({
cloud_name:process.env.CLOUD_NAME,
api_key:process.env.CLOUD_API_KEY,
api_secret:process.env.CLOUD_API_SECRET
})

console.log("☁️ Cloudinary configured")

/* -----------------------------
   Multer Setup
----------------------------- */

const storage = multer.memoryStorage()

const upload = multer({
storage,
limits:{fileSize:5*1024*1024}, //5MB
fileFilter:(req,file,cb)=>{

const allowedTypes=["image/jpeg","image/png","image/jpg","image/webp"]

if(!allowedTypes.includes(file.mimetype)){
console.error("❌ Invalid file type:",file.mimetype)
return cb(new Error("Only image files are allowed"))
}

cb(null,true)

}
})

//Default get Route

app.get("/",(req,res)=>{
   res.send("default get route");
   console.log("GET HOME ROUTE...");
})

/* -----------------------------
   Upload Image Route
----------------------------- */

app.get('/display', (req, res) => {
    res.render('display');
});

app.post('/image-upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    // Convert the image buffer to a Base64 string
    const base64Image = req.file.buffer.toString('base64');
    const imageData = `data:${req.file.mimetype};base64,${base64Image}`;

    // Emit the image data to all connected clients
    io.emit('new-image', imageData);

    res.status(200).send('Image sent to display!');
});


app.post("/upload",upload.single("image"),async(req,res)=>{

try{

if(!req.file){
console.error("❌ No file uploaded")
return res.status(400).json({error:"Image file required"})
}

const caption=req.body.caption || ""

console.log("📤 Uploading image to Cloudinary...")

const result=await new Promise((resolve,reject)=>{

const stream=cloudinary.uploader.upload_stream(
{folder:"goa_trip"},
(error,result)=>{

if(error){
console.error("❌ Cloudinary Upload Error:",error)
reject(error)
}else{
resolve(result)
}

}
)

stream.end(req.file.buffer)

})

const imageUrl=result.secure_url

console.log("☁️ Uploaded to Cloudinary:",imageUrl)

/* Insert into MySQL */

db.query(
"INSERT INTO photos (imageurl,caption) VALUES (?,?)",
[imageUrl,caption],
(err,data)=>{

if(err){
console.error("❌ MySQL Insert Error:",err)
return res.status(500).json({error:"Database insert failed"})
}

console.log("✅ Image saved in database ID:",data.insertId)

res.json({
message:"Image uploaded successfully",
id:data.insertId,
url:imageUrl
})

})

}catch(err){

console.error("❌ Upload Route Error:",err)

res.status(500).json({
error:"Internal server error"
})

}

})

/* -----------------------------
   Get All Photos
----------------------------- */

app.get("/photos",(req,res)=>{

console.log("📥 Fetching gallery photos")

db.query("SELECT * FROM photos ORDER BY id DESC",(err,data)=>{

if(err){
console.error("❌ MySQL Fetch Error:",err)
return res.status(500).json({error:"Database fetch failed"})
}

res.json(data)

})

})

/* -----------------------------
   404 Route
----------------------------- */

app.use((req,res)=>{
console.warn("⚠️ Route not found:",req.originalUrl)
res.status(404).json({error:"Route not found"})
})

/* -----------------------------
   Global Error Handler
----------------------------- */

app.use((err,req,res,next)=>{

console.error("🔥 Global Server Error:",err)

res.status(500).json({
error:"Something went wrong"
})

})

/* -----------------------------
   Start Server
----------------------------- */

server.listen(process.env.PORT,()=>{
console.log(`🚀 Server running on port ${process.env.PORT}`)
})