/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Plus, Pencil, Trash2, BookOpen, Copy } from "lucide-react";
import { toast } from "sonner";
import ImageUpload from "@/components/ImageUpload";
import ConfirmActionDialog from "@/components/ui/confirm-action-dialog";
import { StatCard, StatusBadge, LoadingSpinner, EmptyState, Field, FormCard, IconBtn, CheckboxField, BLOG_STATUSES, BLOG_CATEGORIES } from "./AdminShared";

type BlogForm = {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_image: string;
  author: string;
  category: string;
  tags: string;
  seo_title: string;
  seo_description: string;
  status: string;
  featured: boolean;
  published_at: string;
};

type BlogRow = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string | null;
  cover_image: string | null;
  author: string;
  category: string | null;
  tags: string[] | null;
  seo_title: string | null;
  seo_description: string | null;
  status: string;
  featured: boolean | null;
  published_at: string | null;
};

const emptyBlogForm: BlogForm = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  cover_image: "",
  author: "Pink Paisa",
  category: "Wellness",
  tags: "",
  seo_title: "",
  seo_description: "",
  status: "draft",
  featured: false,
  published_at: "",
};

export const AdminContent = () => {
  const [adminBlogs, setAdminBlogs] = useState<BlogRow[]>([]);
  const [blogsLoading, setBlogsLoading] = useState(false);
  const [showBlogForm, setShowBlogForm] = useState(false);
  const [editingBlogId, setEditingBlogId] = useState<string | null>(null);
  const [blogForm, setBlogForm] = useState<BlogForm>(emptyBlogForm);
  const [savingBlog, setSavingBlog] = useState(false);
  const [blogSearch, setBlogSearch] = useState("");
  const [blogToDelete, setBlogToDelete] = useState<BlogRow | null>(null);

  const fetchBlogs = async () => {
    setBlogsLoading(true);
    try {
      const data = await apiFetch<BlogRow[]>("/blogs?all=true&_sort=createdAt&_order=desc");
      setAdminBlogs(data || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load blogs");
    } finally {
      setBlogsLoading(false);
    }
  };

  useEffect(() => {
    void fetchBlogs();
  }, []);

  const saveBlog = async () => {
    if (!blogForm.title || !blogForm.slug) {
      toast.error("Title and slug required");
      return;
    }

    setSavingBlog(true);

    const payload = {
      title: blogForm.title,
      slug: blogForm.slug,
      excerpt: blogForm.excerpt || null,
      content: blogForm.content || null,
      cover_image: blogForm.cover_image || null,
      author: blogForm.author || "Pink Paisa",
      category: blogForm.category || null,
      tags: blogForm.tags ? blogForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [],
      seo_title: blogForm.seo_title || null,
      seo_description: blogForm.seo_description || null,
      status: blogForm.status,
      featured: blogForm.featured,
      published_at: blogForm.published_at || (blogForm.status === "published" ? new Date().toISOString() : null),
    };

    try {
      await apiFetch(editingBlogId ? `/blogs/${editingBlogId}` : "/blogs", {
        method: editingBlogId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      toast.success(editingBlogId ? "Blog updated" : "Blog created");
      setShowBlogForm(false);
      await fetchBlogs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save blog");
    } finally {
      setSavingBlog(false);
    }
  };

  const deleteBlog = async () => {
    if (!blogToDelete) return;

    try {
      await apiFetch(`/blogs/${blogToDelete.id}`, { method: "DELETE" });
      toast.success("Blog deleted");
      setBlogToDelete(null);
      await fetchBlogs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete blog");
    }
  };

  const openEditBlog = (blog: BlogRow) => {
    setEditingBlogId(blog.id);
    setBlogForm({
      title: blog.title,
      slug: blog.slug,
      excerpt: blog.excerpt ?? "",
      content: blog.content ?? "",
      cover_image: blog.cover_image ?? "",
      author: blog.author,
      category: blog.category ?? "Wellness",
      tags: (blog.tags ?? []).join(", "),
      seo_title: blog.seo_title ?? "",
      seo_description: blog.seo_description ?? "",
      status: blog.status,
      featured: blog.featured ?? false,
      published_at: blog.published_at ? blog.published_at.slice(0, 16) : "",
    });
    setShowBlogForm(true);
  };

  const duplicateBlog = (blog: BlogRow) => {
    setEditingBlogId(null);
    setBlogForm({
      title: `${blog.title} (Copy)`,
      slug: `${blog.slug}-copy`,
      excerpt: blog.excerpt ?? "",
      content: blog.content ?? "",
      cover_image: blog.cover_image ?? "",
      author: blog.author,
      category: blog.category ?? "Wellness",
      tags: (blog.tags ?? []).join(", "),
      seo_title: blog.seo_title ?? "",
      seo_description: blog.seo_description ?? "",
      status: "draft",
      featured: false,
      published_at: "",
    });
    setShowBlogForm(true);
  };

  const filteredBlogs = useMemo(
    () => adminBlogs.filter((blog) => !blogSearch || blog.title.toLowerCase().includes(blogSearch.toLowerCase())),
    [adminBlogs, blogSearch],
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-1 font-serif text-2xl">Publish Content</h2>
        <p className="text-sm text-muted-foreground">Create and manage blog posts and content pages.</p>
      </div>

      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search blogs..." value={blogSearch} onChange={(e) => setBlogSearch(e.target.value)} className="pl-9" />
        </div>
        <Button
          onClick={() => {
            setEditingBlogId(null);
            setBlogForm(emptyBlogForm);
            setShowBlogForm(true);
          }}
        >
          <Plus className="h-4 w-4" /> New Blog
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total" value={adminBlogs.length} />
        <StatCard label="Published" value={adminBlogs.filter((blog) => blog.status === "published").length} color="text-emerald-600" />
        <StatCard label="Drafts" value={adminBlogs.filter((blog) => blog.status === "draft").length} color="text-amber-600" />
        <StatCard label="Featured" value={adminBlogs.filter((blog) => blog.featured).length} color="text-primary" />
      </div>

      {showBlogForm && (
        <FormCard title={editingBlogId ? "Edit Blog" : "New Blog"} onClose={() => setShowBlogForm(false)}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Title">
              <Input
                value={blogForm.title}
                onChange={(e) =>
                  setBlogForm((current) => ({
                    ...current,
                    title: e.target.value,
                    slug: current.slug || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
                  }))
                }
              />
            </Field>
            <Field label="Slug">
              <Input value={blogForm.slug} onChange={(e) => setBlogForm({ ...blogForm, slug: e.target.value })} />
            </Field>
          </div>
          <Field label="Excerpt">
            <Textarea rows={2} value={blogForm.excerpt} onChange={(e) => setBlogForm({ ...blogForm, excerpt: e.target.value })} placeholder="Short preview text..." />
          </Field>
          <Field label="Full Content (Markdown supported)">
            <Textarea rows={12} value={blogForm.content} onChange={(e) => setBlogForm({ ...blogForm, content: e.target.value })} placeholder="Write your blog content here..." />
          </Field>
          <ImageUpload value={blogForm.cover_image} onChange={(url) => setBlogForm({ ...blogForm, cover_image: url })} bucket="product-images" folder="blogs" />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Author">
              <Input value={blogForm.author} onChange={(e) => setBlogForm({ ...blogForm, author: e.target.value })} />
            </Field>
            <Field label="Category">
              <Select value={blogForm.category} onValueChange={(value) => setBlogForm({ ...blogForm, category: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BLOG_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={blogForm.status} onValueChange={(value) => setBlogForm({ ...blogForm, status: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BLOG_STATUSES.map((status) => <SelectItem key={status} value={status} className="capitalize">{status}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Tags (comma-separated)">
            <Input value={blogForm.tags} onChange={(e) => setBlogForm({ ...blogForm, tags: e.target.value })} placeholder="wellness, finance, health" />
          </Field>
          <Field label="Publish Date">
            <Input type="datetime-local" value={blogForm.published_at} onChange={(e) => setBlogForm({ ...blogForm, published_at: e.target.value })} />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="SEO Title">
              <Input value={blogForm.seo_title} onChange={(e) => setBlogForm({ ...blogForm, seo_title: e.target.value })} />
            </Field>
            <Field label="SEO Description">
              <Input value={blogForm.seo_description} onChange={(e) => setBlogForm({ ...blogForm, seo_description: e.target.value })} />
            </Field>
          </div>
          <CheckboxField label="Featured blog" checked={blogForm.featured} onChange={(value) => setBlogForm({ ...blogForm, featured: value })} />
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShowBlogForm(false)}>Cancel</Button>
            <Button onClick={saveBlog} disabled={savingBlog}>{savingBlog ? "Saving..." : "Save"}</Button>
          </div>
        </FormCard>
      )}

      <div className="space-y-3">
        {blogsLoading ? (
          <LoadingSpinner />
        ) : filteredBlogs.length === 0 ? (
          <EmptyState icon={BookOpen} text="No blogs" />
        ) : filteredBlogs.map((blog) => (
          <div key={blog.id} className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
            {blog.cover_image && <img src={blog.cover_image} alt="" className="h-12 w-12 rounded-lg object-cover" />}
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <h4 className="truncate text-sm font-medium">{blog.title}</h4>
                <StatusBadge status={blog.status} />
                {blog.featured && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Featured</span>}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {blog.author} · {blog.category} · {blog.published_at ? new Date(blog.published_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Not published"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <IconBtn onClick={() => openEditBlog(blog)} title="Edit"><Pencil className="h-4 w-4" /></IconBtn>
              <IconBtn onClick={() => duplicateBlog(blog)} title="Duplicate"><Copy className="h-4 w-4" /></IconBtn>
              <IconBtn onClick={() => setBlogToDelete(blog)} title="Delete" danger><Trash2 className="h-4 w-4" /></IconBtn>
            </div>
          </div>
        ))}
      </div>

      <ConfirmActionDialog
        open={Boolean(blogToDelete)}
        onOpenChange={(open) => {
          if (!open) setBlogToDelete(null);
        }}
        title="Delete this blog?"
        description={blogToDelete ? `This will permanently remove "${blogToDelete.title}".` : undefined}
        confirmLabel="Delete blog"
        destructive
        onConfirm={deleteBlog}
      />
    </div>
  );
};
