const Blog = require("../models/Blog");
const { applyQueryParams } = require("./orderController");

const toFlat = (doc) => ({ ...doc, id: doc._id.toString() });

const getBlogs = async (req, res) => {
  try {
    let q = Blog.find();
    // Support ?status=published or ?all=true
    if (req.query.status) q = q.where("status").equals(req.query.status);
    else if (req.query.all !== "true") q = q.where("status").equals("published");
    q = applyQueryParams(q, req);
    if (!req.query._sort) q = q.sort({ published_at: -1 });
    const blogs = await q.lean();
    res.json(blogs.map(toFlat));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getBlog = async (req, res) => {
  try {
    // Support both ID and slug lookup
    let blog = null;
    if (req.params.slug.match(/^[0-9a-fA-F]{24}$/)) {
      blog = await Blog.findById(req.params.slug).lean();
    }
    if (!blog) blog = await Blog.findOne({ slug: req.params.slug }).lean();
    if (!blog) return res.status(404).json({ message: "Blog not found" });
    res.json(toFlat(blog));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createBlog = async (req, res) => {
  try {
    if (Array.isArray(req.body)) {
      const blogs = await Blog.insertMany(req.body, { ordered: false });
      return res.status(201).json(blogs.map((b) => toFlat(b.toObject())));
    }
    const blog = await Blog.create(req.body);
    res.status(201).json(toFlat(blog.toObject()));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const updateBlog = async (req, res) => {
  try {
    const blog = await Blog.findByIdAndUpdate(req.params.id, req.body, { new: true }).lean();
    if (!blog) return res.status(404).json({ message: "Blog not found" });
    res.json(toFlat(blog));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

const deleteBlog = async (req, res) => {
  try {
    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) return res.status(404).json({ message: "Blog not found" });
    res.json({ message: "Blog deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getBlogs, getBlog, createBlog, updateBlog, deleteBlog };
