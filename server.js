const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const SHARE_ID = "p.k7ky5tvxj7vurvtblpjto6ck2a";
const EXPORT_URL = `https://www.imdb.com/user/${SHARE_ID}/watchlist/export`;

const manifest = {
    id: "org.swiftd89.imdbwatchlist",
    version: "1.5.0",
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

let cache = { timestamp: 0, movies: [], series: [] };
const CACHE_TTL = 5 * 60 * 1000;

function parseCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === "," && !inQuotes) {
            result.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

async function fetchWatchlist() {
    const now = Date.now();
    if (now - cache.timestamp < CACHE_TTL && (cache.movies.length > 0 || cache.series.length > 0)) {
        return cache;
    }

    try {
        console.log(`[IMDb Sync] Fetching CSV from ${EXPORT_URL}...`);
        const res = await axios.get(EXPORT_URL, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                "Accept": "text/csv,text/plain,*/*"
            },
            timeout: 12000,
            validateStatus: () => true
        });

        const body = String(res.data || "");
        console.log(`[IMDb Sync] Status: ${res.status}, Length: ${body.length}, Preview: ${body.slice(0, 120).replace(/\n/g, " ")}`);

        const lines = body.split(/\r?\n/).filter(Boolean);
        if (lines.length < 2) {
            return cache;
        }

        const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase());
        const constIdx = headers.indexOf("const");
        const titleIdx = headers.indexOf("title");
        const typeIdx = headers.indexOf("title type");
        const yearIdx = headers.indexOf("year");

        const movies = [];
        const series = [];

        for (let i = 1; i < lines.length; i++) {
            const cols = parseCsvLine(lines[i]);
            const imdbId = cols[constIdx];
            if (!imdbId || !imdbId.startsWith("tt")) continue;

            const title = cols[titleIdx] || imdbId;
            const titleType = (cols[typeIdx] || "").toLowerCase();
            const year = cols[yearIdx] || undefined;

            const isSeries =
                titleType.includes("series") ||
                titleType.includes("mini") ||
                titleType.includes("tv");

            const meta = {
                id: imdbId,
                type: isSeries ? "series" : "movie",
                name: title,
                releaseInfo: year,
                poster: `https://images.metahub.space/poster/medium/${imdbId}/img`,
                posterShape: "poster"
            };

            if (isSeries) {
                series.push(meta);
            } else {
                movies.push(meta);
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
    if (type === "movie" && id === "imdb_watchlist_movies") return { metas: data.movies };
    if (type === "series" && id === "imdb_watchlist_series") return { metas: data.series };
    return { metas: [] };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`IMDb Watchlist Addon running on port ${PORT}`);
