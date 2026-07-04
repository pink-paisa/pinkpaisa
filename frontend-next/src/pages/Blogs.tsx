import { useState, useMemo } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useBlogs, type Blog } from "@/hooks/useBlogs";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Calendar, User, ArrowRight, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { formatDateIN } from "@/lib/date";

const ITEMS_PER_PAGE = 9;

const Blogs = ({ initialBlogs }: { initialBlogs?: Blog[] }) => {
  const { data: blogs, isLoading } = useBlogs(false, initialBlogs);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(1);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    (blogs ?? []).forEach((b) => b.category && cats.add(b.category));
    return Array.from(cats).sort();
  }, [blogs]);

  const featured = useMemo(() => (blogs ?? []).filter((b) => b.featured), [blogs]);

  const filtered = useMemo(() => {
    const list = (blogs ?? []).filter((b) => {
      const matchSearch = !search || b.title.toLowerCase().includes(search.toLowerCase()) || (b.excerpt ?? "").toLowerCase().includes(search.toLowerCase());
      const matchCat = categoryFilter === "all" || b.category === categoryFilter;
      return matchSearch && matchCat;
    });
    list.sort((a, b) => {
      const da = new Date(a.published_at ?? a.created_at ?? 0).getTime();
      const db = new Date(b.published_at ?? b.created_at ?? 0).getTime();
      return sortOrder === "newest" ? db - da : da - db;
    });
    return list;
  }, [blogs, search, categoryFilter, sortOrder]);

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const formatDate = (d: string | null) => {
    if (!d) return "";
    return formatDateIN(d, { day: "numeric", month: "long", year: "numeric" });
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {/* Hero */}
      <section className="relative py-16 md:py-20 bg-gradient-to-b from-accent/40 to-background">
        <div className="container mx-auto px-4 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Badge className="mb-4 bg-primary/10 text-primary border-primary/20">
              <Sparkles className="h-3 w-3 mr-1" /> Pink Paisa Blog
            </Badge>
            <h1 className="font-serif text-4xl md:text-5xl text-foreground mb-4">Insights & Inspiration</h1>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Explore articles on wellness, finance, and personal growth curated by the Pink Paisa team.
            </p>
          </motion.div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-10">
        {/* Featured Blogs */}
        {featured.length > 0 && (
          <div className="mb-12">
            <h2 className="font-serif text-2xl mb-6">Featured</h2>
            <div className="grid md:grid-cols-2 gap-6">
              {featured.slice(0, 2).map((blog) => (
                <FeaturedCard key={blog.id} blog={blog} formatDate={formatDate} />
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search blogs..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-9" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => { setCategoryFilter("all"); setPage(1); }} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${categoryFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>All</button>
            {categories.map((cat) => (
              <button key={cat} onClick={() => { setCategoryFilter(cat); setPage(1); }} className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${categoryFilter === cat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{cat}</button>
            ))}
          </div>
          <button onClick={() => setSortOrder(sortOrder === "newest" ? "oldest" : "newest")} className="px-3 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
            {sortOrder === "newest" ? "Newest first" : "Oldest first"}
          </button>
        </div>

        {/* Blog Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>
        ) : paginated.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground"><p>No blogs found.</p></div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginated.map((blog, i) => (
              <motion.div key={blog.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <BlogCard blog={blog} formatDate={formatDate} />
              </motion.div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-10">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button key={p} onClick={() => setPage(p)} className={`h-10 w-10 rounded-lg text-sm font-medium transition-colors ${page === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{p}</button>
            ))}
          </div>
        )}
      </div>

      <Footer />
    </div>
  );
};

const FeaturedCard = ({ blog, formatDate }: { blog: Blog; formatDate: (d: string | null) => string }) => (
  <Link href={`/blogs/${blog.slug}`} className="group relative rounded-2xl overflow-hidden border border-border bg-card hover:shadow-lg transition-all">
    {blog.cover_image && (
      <div className="aspect-[16/9] overflow-hidden">
        <img src={blog.cover_image} alt={blog.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
      </div>
    )}
    <div className="p-6">
      {blog.category && <Badge variant="secondary" className="mb-3">{blog.category}</Badge>}
      <h3 className="font-serif text-xl mb-2 group-hover:text-primary transition-colors">{blog.title}</h3>
      <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{blog.excerpt}</p>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><User className="h-3 w-3" />{blog.author}</span>
        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDate(blog.published_at)}</span>
      </div>
    </div>
  </Link>
);

const BlogCard = ({ blog, formatDate }: { blog: Blog; formatDate: (d: string | null) => string }) => (
  <Link href={`/blogs/${blog.slug}`} className="group flex flex-col rounded-2xl overflow-hidden border border-border bg-card hover:shadow-md transition-all h-full">
    {blog.cover_image ? (
      <div className="aspect-[16/10] overflow-hidden">
        <img src={blog.cover_image} alt={blog.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
      </div>
    ) : (
      <div className="aspect-[16/10] bg-accent/50 flex items-center justify-center">
        <Sparkles className="h-10 w-10 text-primary/30" />
      </div>
    )}
    <div className="p-5 flex flex-col flex-1">
      {blog.category && <Badge variant="secondary" className="mb-2 w-fit text-[10px]">{blog.category}</Badge>}
      <h3 className="font-serif text-lg mb-2 group-hover:text-primary transition-colors line-clamp-2">{blog.title}</h3>
      <p className="text-sm text-muted-foreground line-clamp-2 mb-4 flex-1">{blog.excerpt}</p>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><User className="h-3 w-3" />{blog.author}</span>
        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatDate(blog.published_at)}</span>
      </div>
      <div className="mt-3 flex items-center gap-1 text-sm font-medium text-primary group-hover:gap-2 transition-all">
        Read More <ArrowRight className="h-4 w-4" />
      </div>
    </div>
  </Link>
);

export default Blogs;

