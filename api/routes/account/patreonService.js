import axios from "axios";
import querystring from "querystring";
import { pool } from "../../db";

const config = {
  patreonClientId: process.env.PATREON_CLIENT_ID,
  patreonClientSecret: process.env.PATREON_CLIENT_SECRET,
  patreonCreatorId: process.env.PATREON_CREATOR_ID,
};

export async function getPatreonOauthTokensFromCode(code) {
  const oauthData = {
    code: code,
    grant_type: "authorization_code",
    redirect_uri: "http://localhost:3000/api/account/patreon",
  };

  return await getPatreonOauthTokens(oauthData);
}

export async function getPatreonOauthTokensFromRefresh(refreshToken) {
  const oauthData = {
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  };

  return await getPatreonOauthTokens(oauthData);
}

async function getPatreonOauthTokens(oauthData) {
  try {
    const res = await axios({
      method: "POST",
      url: "https://www.patreon.com/api/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      data: querystring.stringify({
        ...oauthData,
        client_id: config.patreonClientId,
        client_secret: config.patreonClientSecret,
      }),
    });

    return res.data;
  } catch (e) {
    console.error("Oauth token call fail", e);
  }

  return null;
}

async function fetchIdentity() {}

export async function isActiveOnePageRulesMember(token) {
  async function getMemberships() {
    try {
      const query = querystring.stringify({
        include: "memberships,memberships.currently_entitled_tiers",
        "fields[member]": "patron_status",
      });
      const membershipsResponse = await axios({
        url: "https://www.patreon.com/api/oauth2/v2/identity?" + query,
        method: "GET",
        headers: {
          Authorization: "Bearer " + token,
        },
      });
      return membershipsResponse;
    } catch (e) {
      if (e.response) {
        const { data } = e.response;
        console.error(JSON.stringify(data));
      }

      console.error("Failed to get patreon identity", JSON.stringify(e));
    }
    return null;
  }

  const { data } = await getMemberships();

  try {

    if (data.included) {
      const oprCampaign = data.included
        .filter((item) => item.type === 'member')
        .find((member) => member.id === config.patreonCreatorId);

      // user is not an OPR member
      if (!oprCampaign) {
        return false;
      }

      const patronStatus = oprCampaign.attributes["patron_status"];
      const entitledTiers = oprCampaign.relationships.currently_entitled_tiers.data;

      const isActivePatron = patronStatus === "active_patron";
      const hasActiveTier = entitledTiers.length >= 1;

      return isActivePatron && hasActiveTier;
    }
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function getUserPatreonRefreshToken(userId) {
  // Save refresh token against the user?
  const res = await pool.query(
    "SELECT patreon_refresh_token FROM opr_companion.user_accounts WHERE id = $1",
    [userId]
  );
  return res.rows[0]["patreon_refresh_token"];
}

export async function setUserPatreonRefreshToken(userId, refreshToken) {
  // Save refresh token against the user?
  const res = await pool.query(
    "UPDATE opr_companion.user_accounts SET patreon_refresh_token = $2 WHERE id = $1",
    [userId, refreshToken]
  );
}

export async function getUserPatreonActive(userId) {
  // Save refresh token against the user?
  const res = await pool.query(
    "SELECT patreon_active_until FROM opr_companion.user_accounts WHERE id = $1",
    [userId]
  );
  return res.rows[0]["patreon_refresh_token"];
}

export async function setUserPatreonActive(userId, activeUntil) {
  // Save refresh token against the user?
  const res = await pool.query(
    "UPDATE opr_companion.user_accounts SET patreon_active_until = $2 WHERE id = $1",
    [userId, activeUntil]
  );
}
