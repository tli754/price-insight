-- Price Insight migration validation
select 'competitor' as table_name, count(*) as actual_rows, 97 as expected_rows from public.competitor
union all select 'products', count(*), 649 from public.products
union all select 'orders', count(*), 2878 from public.orders
union all select 'competitor_products', count(*), 3645 from public.competitor_products
union all select 'order_items', count(*), 3538 from public.order_items
union all select 'price_history', count(*), 4685 from public.price_history
union all select 'product_ai_reports', count(*), 3 from public.product_ai_reports
union all select 'product_images', count(*), 4805 from public.product_images
order by table_name;

-- FK orphan checks: every result should be 0.
select 'competitor_products -> products' as check_name, count(*) as orphan_count
from public.competitor_products cp left join public.products p on p.id=cp.product_id where p.id is null
union all
select 'competitor_products -> competitor', count(*)
from public.competitor_products cp left join public.competitor c on c.id=cp.competitor_id where cp.competitor_id is not null and c.id is null
union all
select 'order_items -> orders', count(*)
from public.order_items oi left join public.orders o on o.id=oi.order_id where o.id is null
union all
select 'order_items -> products', count(*)
from public.order_items oi left join public.products p on p.id=oi.product_id where oi.product_id is not null and p.id is null
union all
select 'price_history -> competitor_products', count(*)
from public.price_history ph left join public.competitor_products cp on cp.id=ph.competitor_product_id where cp.id is null
union all
select 'product_ai_reports -> products', count(*)
from public.product_ai_reports r left join public.products p on p.id=r.product_id where p.id is null
union all
select 'product_images -> products', count(*)
from public.product_images i left join public.products p on p.id=i.product_id where p.id is null;
