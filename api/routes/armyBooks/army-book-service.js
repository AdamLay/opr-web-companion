import { pool } from '../../db';
import { nanoid } from 'nanoid';
import * as unitService from './units/unit-service';
import * as spellService from './spells/spell-service';
import * as upgradePackagesService from './upgradePackages/upgrade-packages-service';
import * as specialRulesService from './specialRules/special-rules-service';

/* CREATE */

export async function createArmyBook(userId, enabledGameSystems, name, hint, background) {
  try {
    const insert = await pool.query(
      'INSERT INTO opr_companion.army_books (uid, user_id, enabled_game_systems, name, hint, background) ' +
      'VALUES ($1, $2, $3, $4, $5, $6) RETURNING uid',
      [ nanoid(16), userId, enabledGameSystems, name, hint, background ],
    );
    const { uid } = insert.rows[0];
    const { rows } = await pool.query(
      'SELECT ' +
      'army_books.uid, ' +
      'army_books.enabled_game_systems AS "enabledGameSystems", ' +
      'army_books.name, ' +
      'army_books.hint, ' +
      'army_books.background, ' +
      'army_books.army_wide_rule AS "armyWideRule", ' +
      'army_books.units, ' +
      'army_books.upgrade_packages AS "upgradePackages", ' +
      'army_books.special_rules AS "specialRules", ' +
      'army_books.spells, ' +
      'army_books.version_string AS "versionString", ' +
      'army_books.cover_image_path AS "coverImagePath", ' +
      'army_books.cover_image_credit AS "coverImageCredit", ' +
      'army_books.official, ' +
      'army_books.public, ' +
      'army_books.is_live AS "isLive", ' +
      'army_books.modified_at AS "modifiedAt" ' +
      'FROM opr_companion.army_books ' +
      'WHERE uid = $1',
      [uid]
    );
    return rows[0];
  } catch (e) {
    console.error(e);
    return null;
  }
}

/* READ */

export async function getAll() {
  const { rows } = await pool.query(
    'SELECT ' +
    'army_books.uid, ' +
    'army_books.user_id AS "userId", ' +
    'army_books.enabled_game_systems AS "enabledGameSystems", ' +
    'army_books.name, ' +
    'army_books.hint, ' +
    'army_books.background, ' +
    'army_books.army_wide_rule AS "armyWideRule", ' +
    'army_books.units, ' +
    'army_books.upgrade_packages AS "upgradePackages", ' +
    'army_books.special_rules AS "specialRules", ' +
    'army_books.spells, ' +
    'army_books.modified_at AS "modifiedAt", ' +
    'army_books.official, ' +
    'army_books.public, ' +
    'army_books.version_string AS "versionString", ' +
    'army_books.cover_image_path AS "coverImagePath", ' +
    'army_books.cover_image_credit AS "coverImageCredit", ' +
    'army_books.is_live AS "isLive", ' +
    'army_books.faction_name AS "factionName", ' +
    'army_books.faction_relation AS "factionRelation", ' +
    'user_accounts.username ' +
    'FROM opr_companion.army_books ' +
    'INNER JOIN opr_companion.user_accounts ON army_books.user_id = user_accounts.id ' +
    'ORDER BY army_books.name ASC',
    [],
  );
  return rows;
}

export async function getArmyBookForOwner(armyBookId, userId) {

  const { rows } = await pool.query(
    'SELECT ' +
    'army_books.uid, ' +
    'army_books.enabled_game_systems AS "enabledGameSystems", ' +
    'army_books.name, ' +
    'army_books.hint, ' +
    'army_books.background, ' +
    'army_books.army_wide_rule AS "armyWideRule", ' +
    'army_books.units, ' +
    'army_books.upgrade_packages AS "upgradePackages", ' +
    'army_books.special_rules AS "specialRules", ' +
    'army_books.spells, ' +
    'army_books.modified_at AS "modifiedAt", ' +
    'army_books.official, ' +
    'army_books.public, ' +
    'army_books.version_string AS "versionString", ' +
    'army_books.cover_image_path AS "coverImagePath", ' +
    'army_books.cover_image_credit AS "coverImageCredit", ' +
    'army_books.is_live AS "isLive", ' +
    'army_books.faction_name AS "factionName", ' +
    'army_books.faction_relation AS "factionRelation", ' +
    'user_accounts.username ' +
    'FROM opr_companion.army_books ' +
    'INNER JOIN opr_companion.user_accounts ON army_books.user_id = user_accounts.id ' +
    'WHERE uid = $1 AND user_id = $2 ' +
    'ORDER BY army_books.name ASC',
    [ armyBookId, userId ]
  );

  if (rows.length !== 1) {
    console.error('More than one army book matches the query.');
    return null;
  } else {
    let armyBook = rows[0];
    // enrich unit missing splitPageNumber
    const units = armyBook.units.map(unit => {
      return {
        ...unit,
        splitPageNumber: parseInt(unit.splitPageNumber) || 1,
      }
    })
    return {...armyBook, units};
  }
}

export async function getPublicArmyBooksListView(gameSystemId = 0) {

  const { rows } = await pool.query(
    'SELECT ' +
    'army_books.uid, ' +
    'army_books.enabled_game_systems AS "enabledGameSystems", ' +
    'army_books.name, ' +
    'army_books.hint, ' +
    'army_books.background, ' +
    'army_books.army_wide_rule AS "armyWideRule", ' +
    'jsonb_array_length(army_books.units) AS "unitCount", ' +
    'jsonb_array_length(army_books.upgrade_packages) AS "upgradePackageCount", ' +
    'jsonb_array_length(army_books.special_rules) AS "specialRulesPackageCount", ' +
    'jsonb_array_length(army_books.spells) AS "spellCount", ' +
    'army_books.modified_at AS "modifiedAt", ' +
    'army_books.official, ' +
    'army_books.version_string AS "versionString", ' +
    'army_books.cover_image_path AS "coverImagePath", ' +
    'army_books.cover_image_credit AS "coverImageCredit", ' +
    'army_books.is_live AS "isLive", ' +
    'army_books.faction_name AS "factionName", ' +
    'army_books.faction_relation AS "factionRelation", ' +
    'user_accounts.username ' +
    'FROM opr_companion.army_books ' +
    'INNER JOIN opr_companion.user_accounts ON army_books.user_id = user_accounts.id ' +
    'WHERE army_books.public = true ' +
    'AND (army_books.enabled_game_systems @> $1 OR $2)' +
    'ORDER BY army_books.name ASC',
    [[gameSystemId], gameSystemId === 0]
  );
  return rows.map(armyBook => {
    armyBook.flavouredUid = gameSystemId ? `${armyBook.uid}~${gameSystemId}` : undefined;
    armyBook.armyForgeUrl = `https://army-forge.onepagerules.com/listConfiguration?armyId=${armyBook.uid}${armyBook.factionName ? '&faction='+armyBook.factionName : ''}`
    return armyBook;
  });
}

export async function getPublicArmyBooks(gameSystemId = 0) {

  const { rows } = await pool.query(
    'SELECT ' +
    'army_books.uid, ' +
    'army_books.enabled_game_systems AS "enabledGameSystems", ' +
    'army_books.name, ' +
    'army_books.hint, ' +
    'army_books.background, ' +
    'army_books.army_wide_rule AS "armyWideRule", ' +
    'army_books.units, ' +
    'army_books.upgrade_packages AS "upgradePackages", ' +
    'army_books.special_rules AS "specialRules", ' +
    'army_books.spells, ' +
    'army_books.modified_at AS "modifiedAt", ' +
    'army_books.official, ' +
    'army_books.version_string AS "versionString", ' +
    'army_books.cover_image_path AS "coverImagePath", ' +
    'army_books.cover_image_credit AS "coverImageCredit", ' +
    'army_books.is_live AS "isLive", ' +
    'army_books.faction_name AS "factionName", ' +
    'army_books.faction_relation AS "factionRelation", ' +
    'user_accounts.username ' +
    'FROM opr_companion.army_books ' +
    'INNER JOIN opr_companion.user_accounts ON army_books.user_id = user_accounts.id ' +
    'WHERE army_books.public = true ' +
    'AND (army_books.enabled_game_systems @> $1 OR $2)' +
    'ORDER BY army_books.name ASC',
    [[gameSystemId], gameSystemId === 0]
  );
  return rows.map(armyBook => {
    armyBook.flavouredUid = gameSystemId ? `${armyBook.uid}~${gameSystemId}` : undefined;
    return armyBook;
  });
}

export async function getArmyBookPublicOrOwner(armyBookUid, userId) {
  const { rows } = await pool.query(
    'SELECT ' +
    'army_books.uid, ' +
    'army_books.enabled_game_systems AS "enabledGameSystems", ' +
    'army_books.name, ' +
    'army_books.hint, ' +
    'army_books.background, ' +
    'army_books.army_wide_rule AS "armyWideRule", ' +
    'army_books.units, ' +
    'army_books.upgrade_packages AS "upgradePackages", ' +
    'army_books.special_rules AS "specialRules", ' +
    'army_books.spells, ' +
    'army_books.modified_at AS "modifiedAt", ' +
    'army_books.official, ' +
    'army_books.public, ' +
    'army_books.version_string AS "versionString", ' +
    'army_books.cover_image_path AS "coverImagePath", ' +
    'army_books.cover_image_credit AS "coverImageCredit", ' +
    'army_books.is_live AS "isLive", ' +
    'army_books.faction_name AS "factionName", ' +
    'army_books.faction_relation AS "factionRelation", ' +
    'user_accounts.username ' +
    'FROM opr_companion.army_books ' +
    'INNER JOIN opr_companion.user_accounts ON army_books.user_id = user_accounts.id ' +
    'WHERE uid = $1 AND ( public = true OR user_id = $2 )',
    [ armyBookUid, userId ]
  );

  if (rows.length === 0) {
    console.info(`No entry found for armyBook=${armyBookUid} and user=${userId}.`);
    return null;
  }

  if (rows.length > 1) {
    console.error(`Query returned ${rows.length} entries but expected 1.`);
    return null;
  }

  let armyBook = rows[0];

  // enrich unit missing splitPageNumber
  armyBook.units = armyBook.units.map(unit => {
    return {
      ...unit,
      splitPageNumber: parseInt(unit.splitPageNumber) || 1,
    }
  })

  return armyBook;
}

export async function getAllByUserId(userId) {
  const { rows } = await pool.query(
    'SELECT ' +
    'army_books.uid, ' +
    'army_books.enabled_game_systems AS "enabledGameSystems", ' +
    'army_books.name, ' +
    'army_books.hint, ' +
    'army_books.background, ' +
    'army_books.army_wide_rule AS "armyWideRule", ' +
    'jsonb_array_length(army_books.units) AS "unitCount", ' +
    'jsonb_array_length(army_books.upgrade_packages) AS "upgradePackageCount", ' +
    'jsonb_array_length(army_books.special_rules) AS "specialRulesPackageCount", ' +
    'jsonb_array_length(army_books.spells) AS "spellCount", ' +
    'army_books.modified_at AS "modifiedAt", ' +
    'army_books.official, ' +
    'army_books.public, ' +
    'army_books.version_string AS "versionString", ' +
    'army_books.cover_image_path AS "coverImagePath", ' +
    'army_books.cover_image_credit AS "coverImageCredit", ' +
    'army_books.is_live AS "isLive", ' +
    'army_books.faction_name AS "factionName", ' +
    'army_books.faction_relation AS "factionRelation" ' +
    'FROM opr_companion.army_books ' +
    'WHERE user_id = $1 ' +
    'ORDER BY army_books.name ASC',
    [userId]
  );
  return rows;
}

export async function getSimpleArmyBook(armyBookId) {
  const { rows } = await pool.query(
    'SELECT ' +
    'army_books.uid, ' +
    'army_books.user_id AS "userId", ' +
    'army_books.name, ' +
    'army_books.official, ' +
    'army_books.public, ' +
    'army_books.is_live AS "isLive", ' +
    'army_books.version_string AS "versionString", ' +
    'user_accounts.username ' +
    'FROM opr_companion.army_books ' +
    'INNER JOIN opr_companion.user_accounts ON army_books.user_id = user_accounts.id ' +
    'WHERE uid = $1',
    [ armyBookId ]
  );
  return rows[0];
}

export async function addUnit(armyBookUid, userId, unit) {
  await unitService.addUnit(armyBookUid, userId, unit);
}

export async function setUnits(armyBookUid, userId, units) {
  await unitService.updateUnits(armyBookUid, userId, units);
}

export async function setSpells(armyBookUid, userId, spells) {
  await spellService.updateSpells(armyBookUid, userId, spells);
}

export async function setUpgradePackages(armyBookUid, userId, upgradePackages) {
  await upgradePackagesService.updateUpgradePackages(armyBookUid, userId, upgradePackages);
}

export async function getUnit(armyBookUid, userId, unitId) {
  return await unitService.getUnit(armyBookUid, unitId, unitId);
}

export async function updateUnit(armyBookUid, userId, unitId, unit) {
  await unitService.updateUnit(armyBookUid, unitId, unit, userId);
}

export async function addUpgradePackage(armyBookUid, userId, upgradePackage) {
  await upgradePackagesService.addUpgradePackage(armyBookUid, userId, upgradePackage);
}

export async function getUpgradePackages(armyBookUid, userId) {
  return await upgradePackagesService.getUpgradePackages(armyBookUid, userId);
}

export async function addSpecialRule(armyBookUid, userId, specialRule) {
  return await specialRulesService.addSpecialRule(armyBookUid, userId, specialRule);
}

export async function getSpecialRules(armyBookUid, userId) {
  return await specialRulesService.getSpecialRules(armyBookUid, userId);
}

export async function setSpecialRules(armyBookUid, userId, specialRules) {
  await specialRulesService.updateSpecialRules(armyBookUid, userId, specialRules)
}

export async function deleteArmyBook(armyBookId, userId) {
  await pool.query(
    'DELETE FROM opr_companion.army_books WHERE uid = $1 AND user_id = $2',
    [armyBookId, userId]
  );
}

export async function updateArmyBook(armyBookUid, userId, fields, values) {
  console.info(fields, values)
  await pool.query(
    'UPDATE opr_companion.army_books SET ' +
    fields.join(',') +
    ' WHERE uid = $'+(1+fields.length)+' AND user_id = $'+(2+fields.length)+' ',
    [...values, armyBookUid, userId],
  );
}

// https://stackoverflow.com/questions/39573219/can-i-store-a-word-document-in-a-postgresql-database
export async function savePdfA4(armyBookUid, data, timestamp, service = 'unknown') {
  await pool.query(
    'INSERT INTO opr_companion.army_books_pdfs (army_book_uid, pdf_a4, pdf_a4_created_at, service) ' +
    'VALUES ($1, $2::bytea, $3, $4) ' +
    'ON CONFLICT (army_book_uid) DO '+
    'UPDATE SET pdf_a4 = $2::bytea, pdf_a4_created_at = $3, service = $4',
    [armyBookUid, data, timestamp, service],
  );
}

export async function readPdfA4(armyBookUid) {
  const { rows } = await pool.query(
    'SELECT ' +
    'army_books_pdfs.pdf_a4 AS "byteArray", ' +
    'army_books_pdfs.pdf_a4_created_at AS "createdAt" ' +
    'FROM opr_companion.army_books_pdfs ' +
    'WHERE army_books_pdfs.army_book_uid = $1 ',
    [armyBookUid],
  );
  return rows[0]
}

export async function readPdfLetter(armyBookUid) {
  const { rows } = await pool.query(
    'SELECT army_books_pdfs.pdf_letter AS "pdf" ' +
    'FROM opr_companion.army_books ' +
    'INNER JOIN opr_companion.army_books_pdfs ON army_books.uid = army_books_pdfs.army_book_uid ' +
    'WHERE uid = $1 ' +
    'AND army_books.modified_at::timestamp(0) = army_books_pdfs.pdf_letter_created_at::timestamp(0) ',
    [armyBookUid],
  );
  return rows[0]?.pdf;
}
