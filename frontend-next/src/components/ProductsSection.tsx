import { motion, useInView } from "framer-motion";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Sparkles, Calendar, Target, HelpCircle, BookOpen, ShoppingCart, Check,
} from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import { useProducts, type Product } from "@/hooks/useProducts";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles,
  Calendar,
  Target,
  HelpCircle,
  BookOpen,
};

const cardVariants = {
  hidden: { opacity: 0, y: 20, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const ProductCard = ({ product, index }: { product: Product; index: number }) => {
  const Icon = iconMap[product.icon] ?? Sparkles;
  const { addItem, items } = useCart();
  const isInCart = items.some((i) => i.id === product.id);
  const includes = Array.isArray(product.includes) ? product.includes : [];

  const handleAdd = () => {
    addItem({
      id: product.id,
      title: product.title,
      price: Number(product.price),
      priceMax: Number(product.price_max ?? product.price),
      format: product.format ?? "",
      slug: product.slug,
      image_url: null,
      stock_quantity_at_add: null,
    });
    toast.success(`${product.title} added to cart`);
  };

  const formatPrice = (n: number) => `₹${n.toLocaleString("en-IN")}`;

  return (
    <motion.div
      variants={cardVariants}
      transition={{ duration: 0.6, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow duration-300 hover:shadow-xl hover:shadow-primary/8"
    >
      <div className="flex flex-1 flex-col p-6 md:p-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          {product.badge && (
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${product.badge_color ?? "bg-accent text-accent-foreground"}`}>
              {product.badge}
            </span>
          )}
        </div>

        <h3 className="mb-1 font-serif text-xl leading-tight md:text-2xl">{product.title}</h3>
        {product.subtitle && (
          <p className="mb-3 text-sm font-medium text-primary">{product.subtitle}</p>
        )}
        {product.description && (
          <p className="mb-5 text-sm leading-relaxed text-muted-foreground">{product.description}</p>
        )}

        <ul className="mb-6 space-y-2">
          {includes.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-foreground">
              <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-auto">
          {product.format && (
            <p className="mb-1 text-xs text-muted-foreground">{product.format}</p>
          )}
          <div className="mb-4 flex items-baseline gap-2">
            <span className="font-serif text-2xl font-bold text-foreground">
              {formatPrice(Number(product.price))}
            </span>
            {product.price_max && (
              <span className="text-sm text-muted-foreground">
                – {formatPrice(Number(product.price_max))}
              </span>
            )}
          </div>
          <Button variant="product" size="lg" onClick={handleAdd}>
            {isInCart ? (
              <><Check className="h-4 w-4" /> In Cart — Add Again</>
            ) : (
              <><ShoppingCart className="h-4 w-4" /> Add to Cart</>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
};

const ProductsSection = ({ initialProducts }: { initialProducts?: Product[] }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.1 });
  const { data: products, isLoading } = useProducts(false, initialProducts);

  return (
    <section id="programs" className="bg-background py-20 md:py-28">
      <div className="container mx-auto">
        <motion.div
          ref={ref}
          initial="hidden"
          animate={isInView ? "visible" : "hidden"}
          transition={{ staggerChildren: 0.08 }}
        >
          <motion.div
            variants={cardVariants}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="mb-14 max-w-xl"
          >
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">
              Virtual Programs
            </p>
            <h2 className="mb-4 font-serif text-3xl leading-tight md:text-4xl">
              Everything you need to start your wealth journey
            </h2>
            <p className="text-lg text-muted-foreground">
              From quick-start templates to deep-dive courses — pick what
              matches where you are right now.
            </p>
          </motion.div>

          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-96 rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {(products ?? []).map((product, i) => (
                <ProductCard key={product.id} product={product} index={i} />
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
};

export default ProductsSection;
