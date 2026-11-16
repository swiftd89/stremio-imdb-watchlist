const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const PROFILE_SHARE_ID = "p.k7ky5tvxj7vurvtblpjto6ck2a";
const USER_ID = "ur113060684";
const WATCHLIST_URL = `https://www.imdb.com/user/${PROFILE_SHARE_ID}/watchlist/`;

const manifest = {
    id: "org.swiftd89.imdbwatchlist",
    version: "1.4.0",
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

async function fetchViaGraphQL(targetUserId) {
    const query = `
    query WatchlistQuery($userId: ID!) {
      userProfile(input: { userId: $userId }) {
        userId
      }
      predefinedList(classType: WATCH_LIST, userId: $userId) {
        items(first: 250) {
          edges {
            node {
              item {
                ... on Title {
                  id
                  titleText { text }
                  titleType { id }
                  releaseYear { year }
                }
              }
            }
          }
        }
      }
    }`;

    const res = await axios.post(
        "https://caching.graphql.imdb.com/",
        {
            query,
            variables: { userId: targetUserId }
        },
        {
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "x-imdb-client-name": "imdb-web-next"
            },
            timeout: 10000,
            validateStatus: () => true
        }
    );

    if (res.status !== 200 || res.data?.errors) {
        console.error(`[GraphQL Debug (${targetUserId})]: Status ${res.status} - ${JSON.stringify(res.data?.errors || res.data).slice(0, 300)}`);
        return [];
    }

    const edges = res.data?.data?.predefinedList?.items?.edges || [];
    const items = [];

    for (const edge of edges) {
        const titleNode = edge?.node?.item;
        if (!titleNode?.id) continue;
        items.push({
            id: titleNode.id,
            name: titleNode.titleText?.text || titleNode.id,
            typeId: (titleNode.titleType?.id || "").toLowerCase(),
            year: titleNode.releaseYear?.year
        });
    }

    return items;
}

async function fetchWatchlist() {
    const now = Date.now();
    if (now - cache.timestamp < CACHE_TTL && (cache.movies.length > 0 || cache.series.length > 0)) {
        return cache;
    }

    try {
        console.log(`[IMDb Sync] Querying GraphQL...`);
        let items = await fetchViaGraphQL(USER_ID);

        if (items.length === 0) {
            items = await fetchViaGraphQL(PROFILE_SHARE_ID);
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
