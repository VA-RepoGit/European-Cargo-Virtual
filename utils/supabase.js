import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export async function isArticlePosted(id) {
  const { data, error } = await supabase
    .from('posted_articles')
    .select('id')
    .eq('id', id)
    .single();

  return !!data;
}

export async function markArticleAsPosted({ id, title, link, published }) {
  const { error } = await supabase.from('posted_articles').insert([
    {
      id,
      title,
      link,
      published,
    }
  ]);

  if (error) {
    console.error('Erreur lors de l\'insertion de l\'article :', error.message);
  }
}
