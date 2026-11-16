const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const WATCHLIST_URL = "https://www.imdb.com/user/p.k7ky5tvxj7vurvtblpjto6ck2a/watchlist/";

const manifest = {
    id: "org.swiftd89.imdbwatchlist",
    version: "1.1.0",
    name: "IMDb Watchlist 🎬",
    description: "Live sync of IMDb Watchlist",
    resources: ["catalog"],
    types: ["movie", "series"],
    catalogs: [
        {
            type: "movie",
            id: "imdb_watchlist_movies",
            name: "IMDb Watchlist"
        },
        {
            type: "series",
            id: "imdb_watchlist_series",
            name: "IMDb Watchlist"
        }
    ]
};

const builder = new addonBuilder(manifest);

let cache = {
    timestamp: 0,
    movies: [],
    series: []
};
const CACHE_TTL = 10 * 60 * 1000;

function extractTitlesFromJson(obj, results = new Map()) {
    if (!obj || typeof obj !== "object") return results;

    if (obj.id && typeof obj.id === "string" && /^tt\d{6,10}$/.test(obj.id)) {
        const titleText =
            obj.titleText?.text ||
            obj.originalTitleText?.text ||
            obj.name ||
            obj.id;

        const typeId = (
            obj.titleType?.id ||
            obj.titleType?.text ||
            ""
        ).toLowerCase();

        const year = obj.releaseYear?.year || undefined;

        if (!results.has(obj.id) || (titleText !== obj.id && results.get(obj.id).name === obj.id)) {
            results.set(obj.id, {
                id: obj.id,
                name: titleText,
                typeId,
                year
            });
        }
    }

    if (Array.isArray(obj)) {
        for (const item of obj) extractTitlesFromJson(item, results);
    } else {
        for (const key of Object.keys(obj)) {
            extractTitlesFromJson(obj[key], results);
        }
    }
    return results;
}

async function fetchWatchlist() {
    const now = Date.now();
    if (now - cache.timestamp < CACHE_TTL && (cache.movies.length > 0 || cache.series.length > 0)) {
        return cache;
    }

    try {
        console.log(`[IMDb Sync] Fetching watchlist HTML from ${WATCHLIST_URL}...`);
        const response = await axios.get(WATCHLIST_URL, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9"
            },
            timeout: 12000
        });

        const html = response.data;
        const movies = [];
        const series = [];

        const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);

        if (nextDataMatch && nextDataMatch[1]) {
            const jsonData = JSON.parse(nextDataMatch[1]);
            const extractedMap = extractTitlesFromJson(jsonData);

            for (const item of extractedMap.values()) {
                const isSeries =
                    item.typeId.includes("series") ||
                    item.typeId.includes("mini") ||
                    item.typeId.includes("tv");

                const metaPreview = {
                    id: item.id,
                    type: isSeries ? "series" : "movie",
                    name: item.name,
                    releaseInfo: year ? String(item.year) : undefined,
                    poster: `https://images.metahub.space/poster/medium/${item.id}/img`,
                    posterShape: "poster"
                };

                if (isSeries) {
                    series.push(metaPreview);
                } else {
                    movies.push(metaPreview);
                }
            }
        } else {
            const idMatches = [...new Set(html.match(/tt\d{7,9}/g) || [])];
            for (const imdbId of idMatches) {
                movies.push({
                    id: imdbId,
                    type: "movie",
                    name: imdbId,
                    poster: `https://images.metahub.space/poster/medium/${imdbId}/img`,
                    posterShape: "poster"
                });
            }
        }

        console.log(`[IMDb Sync] Parsed ${movies.length} movies and ${series.length} series.`);
        if (movies.length > 0 || series.length > 0) {
            cache = { timestamp: now, movies, series };
        }
        return cache;
    } catch (err) {
        console.error("[IMDb Sync Error]:", err.message);
        return cache;
    }
}

builder.defineCatalogHandler(async ({ type, id }) => {
    console.log(`[Catalog Request] Type: ${type}, ID: ${id}`);
    const data = await fetchWatchlist();

    if (type === "movie" && id === "imdb_watchlist_movies") {
        return { metas: data.movies };
    }
    if (type === "series" && id === "imdb_watchlist_series") {
        return { metas: data.series };
    }

    return { metas: [] };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`IMDb Watchlist Addon running on port ${PORT}`);
