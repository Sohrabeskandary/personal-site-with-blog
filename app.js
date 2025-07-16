// ✅ REWRITTEN VERSION OF YOUR app.js USING express-fileupload ONLY
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import session from "express-session";
import cookieParser from "cookie-parser";
import connectSqlite3 from "connect-sqlite3";
import dotenv from "dotenv";
import fileUpload from "express-fileupload";
import pool from "./db.js";

dotenv.config();

const app = express();
const port = process.env.PORT;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SQLiteStore = connectSqlite3(session);

// ✅ Middleware
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
app.use(fileUpload());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(express.static(path.join(__dirname, "public")));
app.set("views", path.join(__dirname, "views"));

// ✅ Middleware to check admin access
function requireAdmin(req, res, next) {
  if (req.session.isAdmin) {
    next();
  } else {
    res.redirect(process.env.ADMIN_LOGIN_URL);
  }
}

// ✅ ROUTES
app.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT 
         id,
         title,
         slug AS summary,
         thumbnail_url AS image
       FROM posts
       ORDER BY id DESC;`
    );
    res.render("home.ejs", {
      latestPosts: rows,
      isAdmin: req.session.isAdmin || false,
    });
  } catch (err) {
    console.error("DB error loading blog:", err);
    res.status(500).send("خطا در بارگذاری مطالب");
  }
});

app.get("/blog", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT 
         id,
         title,
         slug AS summary,
         thumbnail_url AS image
       FROM posts
       ORDER BY id DESC;`
    );

    res.render("blog.ejs", {
      posts: rows,
      isAdmin: req.session.isAdmin || false,
    });
  } catch (err) {
    console.error("DB error loading blog:", err);
    res.status(500).send("خطا در بارگذاری مطالب");
  }
});

app.get("/blog/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send("شناسه نامعتبر است");
  }

  try {
    const { rows } = await pool.query(
      `SELECT 
         id,
         title,
         slug AS summary,
         content,
         thumbnail_url AS image
       FROM posts
       WHERE id = $1
       LIMIT 1;`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).send("مطلب یافت نشد");
    }

    const post = rows[0];
    res.render("blog-post.ejs", {
      post,
      isAdmin: req.session.isAdmin || false,
    });
  } catch (err) {
    console.error("DB error loading post:", err);
    res.status(500).send("خطا در بارگذاری مطلب");
  }
});

// ✅ Admin login/logout
app.get(process.env.ADMIN_LOGIN_URL, (req, res) => {
  res.render("admin-login.ejs");
});

app.post(process.env.ADMIN_LOGIN_URL, (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.redirect("/blog");
  } else {
    res.send("رمز عبور اشتباه است.");
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.post("/delete-post/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).send("شناسه نامعتبر است");
  }

  try {
    // Grab thumbnail path while deleting
    const { rows } = await pool.query(
      "DELETE FROM posts WHERE id = $1 RETURNING thumbnail_url;",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).send("مطلب یافت نشد");
    }

    const thumb = rows[0].thumbnail_url;
    if (thumb) {
      // Normalize path: DB stores like '/uploads/xyz.jpg'
      const rel = thumb.startsWith("/") ? thumb.slice(1) : thumb;
      const imgPath = path.join(__dirname, "public", rel);
      fs.unlink(imgPath, (err) => {
        if (err && err.code !== "ENOENT") {
          console.warn("Image deletion failed:", imgPath, err);
        }
      });
    }

    res.redirect("/blog"); // 303 optional: res.redirect(303, "/blog");
  } catch (err) {
    console.error("DB delete error:", err);
    res.status(500).send("خطا در حذف مطلب");
  }
});

app.get("/edit-post/:id", requireAdmin, async (req, res, next) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    console.warn("[edit-post] invalid id:", req.params.id);
    return res.status(400).send("شناسه نامعتبر است");
  }

  try {
    const result = await pool.query(
      `SELECT 
         id,
         title,
         slug AS summary,           -- we'll show/edit summary in form
         content,
         thumbnail_url AS image     -- expected by template
       FROM posts
       WHERE id = $1
       LIMIT 1;`,
      [id]
    );

    console.log("[edit-post] rows returned:", result.rowCount);

    if (result.rowCount === 0) {
      return res.status(404).send("مطلب یافت نشد");
    }

    const post = result.rows[0];
    // Debug line: comment out after confirming
    console.log("[edit-post] post:", post);

    res.render("edit-post.ejs", {
      post,
      isAdmin: req.session.isAdmin || false,
    });
  } catch (err) {
    console.error("[edit-post] DB error:", err);
    return next(err); // goes to global error handler
  }
});

app.post("/edit-post/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { title, summary, content } = req.body;

  try {
    const current = await pool.query(
      "SELECT thumbnail_url FROM posts WHERE id = $1",
      [id]
    );
    if (current.rows.length === 0) return res.status(404).send("یافت نشد");

    let image = current.rows[0].thumbnail_url;

    // ✅ If new image uploaded via express-fileupload
    if (req.files && req.files.image) {
      const file = req.files.image;

      // Validate image type
      if (!file.mimetype.startsWith("image/")) {
        return res.status(400).send("فقط فایل تصویری مجاز است");
      }

      // Delete old image if exists
      if (image) {
        const oldPath = path.join(__dirname, "public", image);
        fs.unlink(oldPath, (err) => {
          if (err && err.code !== "ENOENT")
            console.warn("Delete old image failed:", err);
        });
      }

      // Save new image
      const uniqueName = Date.now() + "-" + file.name;
      const uploadPath = path.join(__dirname, "public/uploads", uniqueName);
      await file.mv(uploadPath);
      image = "/uploads/" + uniqueName;
    }

    await pool.query(
      "UPDATE posts SET title=$1, slug=$2, content=$3, thumbnail_url=$4 WHERE id=$5",
      [title, summary, content, image, id]
    );

    res.redirect("/blog");
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).send("خطا در بروزرسانی مطلب");
  }
});

// ✅ New post using DB and express-fileupload
app.get("/new-post", requireAdmin, (req, res) => {
  res.render("new-post.ejs");
});

app.post("/new-post", requireAdmin, async (req, res) => {
  try {
    const { title, summary, content } = req.body;
    const file = req.files?.image;
    let image_url = "";

    if (file) {
      const filename = Date.now() + "-" + file.name;
      const uploadPath = path.join(__dirname, "public/uploads", filename);
      await file.mv(uploadPath);
      image_url = "/uploads/" + filename;
    }

    await pool.query(
      "INSERT INTO posts (title, slug, content, thumbnail_url) VALUES ($1, $2, $3, $4)",
      [title, summary, content, image_url]
    );
    res.redirect("/new-post");
  } catch (err) {
    console.error("Post creation error:", err);
    res.status(500).send("خطا در ایجاد پست.");
  }
});

// ✅ TinyMCE image upload endpoint
app.post("/upload-image", (req, res) => {
  const file = req.files?.file;
  if (!file) return res.status(400).json({ error: "No file uploaded." });
  if (!file.mimetype.startsWith("image/")) {
    return res.status(400).json({ error: "Only image files allowed." });
  }
  const filename = Date.now() + "-" + file.name;
  const uploadPath = path.join(__dirname, "public/uploads", filename);

  file.mv(uploadPath, (err) => {
    if (err) {
      console.error("❌ Image upload failed:", err);
      return res.status(500).json({ error: "Upload failed." });
    }
    res.json({ location: "/uploads/" + filename });
  });
});

// ✅ Global error handler
app.use((err, req, res, next) => {
  console.error("❌ Uncaught error:", err);
  res.status(500).send("خطایی رخ داده است.");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
