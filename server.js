const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const PROFILE_ID = "p.k7ky5tvxj7vurvtblpjto6ck2a";
const WATCHLIST_URL = `https://www.imdb.com/user/${PROFILE_ID}/watchlist/`;

const manifest = {
    id: "org.swiftd89.imdbwatchlist",
    version: "1.3.0",
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
const CACHE_TTL = 5 * 60 * 1000;

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

        const releaseYear = obj.releaseYear?.year || undefined;

        if (!results.has(obj.id) || (titleText !== obj.id && results.get(obj.id).name === obj.id)) {
            results.set(obj.id, {
                id: obj.id,
                name: titleText,
                typeId,
                year: releaseYear
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

// Primary: IMDb GraphQL API (bypasses frontend AWS WAF HTML challenge)
async function fetchViaGraphQL() {
    const query = `
    query WatchlistQuery($userId: ID!) {
      user(id: $userId) {
        watchlist(first: 250) {
          edges {
            node {
              id
              titleText { text }
              titleType { id }
              releaseYear { year }
            }
          }
        }
      }
    }`;

    const res = await axios.post(
        "https://caching.graphql.imdb.com/",
        {
            query,
            variables: { userId: PROFILE_ID }
        },
        {
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "x-imdb-client-name": "imdb-web-next"
            },
            timeout: 10000
        }
    );

    const edges = res.data?.data?.user?.watchlist?.edges || [];
    const items = [];

    for (const edge of edges) {
        const node = edge?.node;
        if (!node?.id) continue;
        items.push({
            id: node.id,
            name: node.titleText?.text || node.id,
            typeId: (node.titleType?.id || "").toLowerCase(),
            year: node.releaseYear?.year
        });
    }

    return items;
}

// Fallback: Residential Proxy Bridge if direct HTML is WAF-challenged
async function fetchViaFallbackProxy() {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(WATCHLIST_URL)}`;
    const res = await axios.get(proxyUrl, { timeout: 15000 });
    const html = String(res.data);

    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextDataMatch && nextDataMatch[1]) {
        const jsonData = JSON.parse(nextDataMatch[1]);
        return Array.from(extractTitlesFromJson(jsonData).values());
    }
    return [];
}

async function fetchWatchlist() {
    const now = Date.now();
    if (now - cache.timestamp < CACHE_TTL && (cache.movies.length > 0 || cache.series.length > 0)) {
        return cache;
    }

    try {
        console.log(`[IMDb Sync] Querying GraphQL for ${PROFILE_ID}...`);
        let items = [];

        try {
            items = await fetchViaGraphQL();
            console.log(`[IMDb Sync] GraphQL returned ${items.length} items.`);
        } catch (gqlErr) {
            console.error(`[IMDb GraphQL Error]: ${gqlErr.message}`);
        }

        if (items.length === 0) {
            console.log(`[IMDb Sync] Trying fallback proxy fetch...`);
            items = await fetchViaFallbackProxy();
            console.log(`[IMDb Sync] Fallback proxy returned ${items.length} items.`);
        }

        const movies = [];
        const series = [];

        for (const item of items) {
            const isSeries =
                item.typeId.includes("series") ||
                item.typeId.includes("mini") ||
                item.typeId.includes("tv");

            const metaPreview = {
                id: item.id,
                type: isSeries ? "series" : "movie",
                name: item.name,
                releaseInfo: item.year ? String(item.year) : undefined,
                poster: `https://images.metahub.space/poster/medium/${item.id}/img`,
                posterShape: "poster"
            };

            if (isSeries) {
                series.push(metaPreview);
            } else {
                movies.push(metaPreview);
            }
        }

        console.log(`[IMDb Sync] Final parsed: ${movies.length} movies and ${series.length} series.`);
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
