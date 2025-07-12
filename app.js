import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";
import session from "express-session";
import cookieParser from "cookie-parser";
import connectSqlite3 from "connect-sqlite3";
import "dotenv/config";
import pool from "./db.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const port = process.env.PORT;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("views", path.join(__dirname, "views"));
const SQLiteStore = connectSqlite3(session);

app.use(
  session({
    store: new SQLiteStore(),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 60 * 1000, httpOnly: true, path: "/" },
  })
);
app.use(cookieParser());

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// app.set("view engine", "ejs");

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads");
  },
  filename: (req, file, cb) => {
    // Save file with original name + timestamp
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: imageStorage });

app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows[0]);
  } catch (error) {
    console.error("DB Error:", error);
    res.status(500).send("خطا در اتصال به دیتابیس");
  }
});

app.get("/", (req, res) => {
  const postsPath = path.join(__dirname, "data", "posts.json");

  fs.readFile(postsPath, "utf-8", (err, data) => {
    if (err) {
      console.error("Error reading posts:", err);
      return res.status(500).send("خطا در بارگذاری مطالب");
    }

    const allPosts = JSON.parse(data);

    const latestPosts = allPosts.slice(-3);
    res.render("home.ejs", { latestPosts });
  });
});

app.get("/blog", (req, res) => {
  const postsPath = path.join(__dirname, "data", "posts.json");
  const posts = JSON.parse(fs.readFileSync(postsPath, "utf-8"));
  posts.reverse();
  res.render("blog.ejs", { posts });
});

app.get("/blog/:id", (req, res) => {
  const postsPath = path.join(__dirname, "data", "posts.json");
  fs.readFile(postsPath, "utf-8", (err, data) => {
    if (err) return res.status(500).send("خطا در بارگذاری مطالب");

    const posts = JSON.parse(data);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send("شناسه نامعتبر است");
    const post = posts.find((p) => p.id === id);

    if (!post) return res.status(404).send("مطلب یافت نشد");

    res.render("blog-post.ejs", { post });
  });
});

app.get(process.env.ADMIN_LOGIN_URL, (req, res) => {
  res.render("admin-login.ejs");
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function requireAdmin(req, res, next) {
  if (req.session.isAdmin) {
    next();
  } else {
    res.redirect(process.env.ADMIN_LOGIN_URL);
  }
}

app.post(process.env.ADMIN_LOGIN_URL, (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.redirect(process.env.DASHBOARD_URL);
  } else {
    res.send("رمز عبور اشتباه است.");
  }
});

app.get(process.env.DASHBOARD_URL, requireAdmin, (req, res) => {
  const postsPath = path.join(__dirname, "data", "posts.json");
  const posts = JSON.parse(fs.readFileSync(postsPath, "utf-8")).reverse();
  res.render("admin-dashboard.ejs", { posts });
});

app.post(
  process.env.DASHBOARD_URL,
  requireAdmin,
  upload.single("image"),
  (req, res) => {
    const { title, summary, content } = req.body;
    const image = req.file ? "/uploads/" + req.file.filename : "";

    const postsPath = path.join(__dirname, "data", "posts.json");

    fs.readFile(postsPath, "utf-8", (err, data) => {
      if (err) return res.status(500).send("خطا در بارگذاری فایل");

      const posts = JSON.parse(data);
      const newPost = {
        id: posts.length + 1,
        title,
        image,
        summary,
        content,
      };

      posts.push(newPost);

      fs.writeFile(postsPath, JSON.stringify(posts, null, 2), (err) => {
        if (err) return res.status(500).send("خطا در ذخیره مطلب");
        res.redirect(process.env.DASHBOARD_URL);
      });
    });
  }
);

app.post("/delete-post/:id", requireAdmin, (req, res) => {
  const postId = parseInt(req.params.id);
  const postsPath = path.join(__dirname, "data", "posts.json");

  fs.readFile(postsPath, "utf-8", (err, data) => {
    if (err) return res.status(500).send("خطا در خواندن فایل");

    let posts = JSON.parse(data);
    const postToDelete = posts.find((p) => p.id === postId);

    // Remove the post
    posts = posts.filter((post) => post.id !== postId);

    // Delete associated image file if it exists
    if (postToDelete && postToDelete.image) {
      const imagePath = path.join(__dirname, "public", postToDelete.image);
      fs.unlink(imagePath, (err) => {
        if (err) console.warn("Image not found or already deleted:", imagePath);
      });
    }

    // Rewrite posts.json
    fs.writeFile(postsPath, JSON.stringify(posts, null, 2), (err) => {
      if (err) return res.status(500).send("خطا در ذخیره فایل");

      res.redirect(process.env.DASHBOARD_URL);
    });
  });
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.use((err, req, res, next) => {
  console.error("❌ Uncaught error:", err);
  res.status(500).send("خطایی رخ داده است.");
});

app.listen(port, () => {
  console.log(`server is running on port ${process.env.port}`);
});
