import { EmbedBuilder } from 'discord.js';
import { isArticlePosted, markArticleAsPosted } from './utils/supabase.js';
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

export async function fetchAndPostRSS(client) {
  try {
    const startTime = new Date();
    console.log(`[${startTime.toISOString()}] ⏰ Début vérification RSS...`);

    // 🔗 Conversion RSS → JSON via rss2json
    const rssUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(process.env.RSS_FEED_URL)}`;
    const response = await fetch(rssUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0; +https://discordapp.com)' }
    });

    console.log(`🔍 Code HTTP : ${response.status}`);
    if (!response.ok) throw new Error(`Status code ${response.status}`);

    const data = await response.json();
    console.log(`✅ Flux reçu avec ${data.items?.length || 0} articles.`);

    if (!data.items || data.items.length === 0) {
      console.log('⚠️ Aucun article trouvé dans le flux.');
      return;
    }

    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    let newPosts = 0;

    for (const item of data.items) {
      const articleId = item.guid || item.link;
      const alreadyPosted = await isArticlePosted(articleId);
      if (alreadyPosted) continue;

      console.log(`🆕 Nouvel article détecté : ${item.title}`);

      // 🖼️ Récupération de l’image
      let imageUrl = extractImageFromDescription(item.description) || item.thumbnail;
      if (!imageUrl) imageUrl = await fetchImageFromArticle(item.link);

      console.log(`🖼️ Image trouvée : ${imageUrl || 'Aucune'}`);

      const embed = new EmbedBuilder()
        .setTitle(`📰 ${item.title}`)
        .setURL(item.link)
        .setDescription(
          (item.description?.replace(/(<([^>]+)>)/gi, '').substring(0, 300) || 'No description available') + '...'
        )
        .setColor('#c90021') // ✅ Couleur rouge restaurée
        .setTimestamp(new Date(item.pubDate || Date.now()));

      if (imageUrl) embed.setImage(imageUrl);

      await channel.send({ embeds: [embed] });

      await markArticleAsPosted({
        id: articleId,
        title: item.title,
        link: item.link,
        published: item.pubDate || new Date().toISOString()
      });

      console.log(`✅ Article publié : ${item.title}`);
      newPosts++;
    }

    console.log(`[${new Date().toISOString()}] ✅ Vérification terminée. (${newPosts} nouveaux articles publiés)`);
  } catch (error) {
    console.error('❌ Erreur lors de la récupération du flux RSS :', error);
  }
}

// 🔍 Extrait la première image du contenu RSS (HTML)
function extractImageFromDescription(description) {
  if (!description) return null;
  const $ = cheerio.load(description);
  let img = $('img').first().attr('src');
  return img?.startsWith('http') ? img : null;
}

// 🧠 Récupère la première image depuis la page web de l’article
async function fetchImageFromArticle(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    console.log(`🌐 Lecture page article : ${response.status} ${url}`);
    if (!response.ok) throw new Error(`Status code ${response.status}`);

    const html = await response.text();
    const $ = cheerio.load(html);

    // 🔎 Recherche de l’image à partir des métadonnées et du contenu
    let imgSrc =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('meta[name="image"]').attr('content') ||
      $('article img').first().attr('src') ||
      $('figure img').first().attr('src') ||
      $('img').first().attr('src');

    if (!imgSrc) {
      console.log('❌ Aucune image trouvée dans les balises HTML.');
      return null;
    }

    // Si l’image est en chemin relatif → conversion absolue
    if (imgSrc.startsWith('/')) {
      const baseUrl = new URL(url).origin;
      imgSrc = baseUrl + imgSrc;
    }

    // Vérifie que l’image est valide
    if (!imgSrc.startsWith('http')) {
      console.log(`⚠️ Lien image invalide : ${imgSrc}`);
      return null;
    }

    const headCheck = await fetch(imgSrc, { method: 'HEAD' });
    if (!headCheck.ok) {
      console.log(`⚠️ Image introuvable (${headCheck.status}) : ${imgSrc}`);
      return null;
    }

    console.log(`✅ Image extraite avec succès : ${imgSrc}`);
    return imgSrc;
  } catch (err) {
    console.error('⚠️ Erreur lors de la récupération de l’image depuis la page :', err.message);
    return null;
  }
}
