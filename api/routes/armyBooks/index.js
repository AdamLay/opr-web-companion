import Router from 'express-promise-router';
import cors from 'cors';
import { nanoid } from 'nanoid';

import * as armyBookService from './army-book-service';
import * as skirmificationService from './skirmification-service';
import * as pdfService from './pdf-service';
import * as gameSystemService from '../gameSystems/game-system-service';
import * as upgradePackagesService from './upgradePackages/upgrade-packages-service';
import * as unitService from './units/unit-service';
import userAccountService from '../auth/user-account-service';

import units from './units';
import upgradePackages from './upgradePackages';
import specialRules from './specialRules';
import spells from './spells';
import statistics from './statistics';
import { CalcHelper, ArmyBook } from "opr-army-book-helper";
import calc from "opr-point-calculator-lib";
import { DataParsingService } from 'opr-data-service';

const router = new Router();

router.use('/statistics', statistics);
router.use('/:armyBookUid/units', units);
router.use('/:armyBookUid/upgrade-packages', upgradePackages);
router.use('/:armyBookUid/special-rules', specialRules);
router.use('/:armyBookUid/spells', spells);

router.get('/', cors(), async (request, response) => {

  const { gameSystemSlug } = request.query;

  // all original army books for this system
  const gameSystem = await gameSystemService.getGameSystemBySlug(gameSystemSlug);
  let items = await armyBookService.getPublicArmyBooksListView(gameSystem?.id || 0);

  response.set('Cache-Control', 'public, max-age=600'); // 5 minutes
  response.status(200).json(items);

});

router.get('/mine', async (request, response) => {
  const armyBooks = await armyBookService.getAllByUserId(request.me.userId);

  //response.set('Cache-Control', 'public, max-age=300'); // 5 minutes
  response.status(200).json(armyBooks);
});

router.post('/', async (request, response) => {
  const { name, hint, gameSystemId, background } = request.body;

  const armyBook = await armyBookService.createArmyBook(request.me.userId, [gameSystemId], name, hint, background);

  if (armyBook) {
    response.status(200).json(armyBook);
  } else {
    response.status(400).json({message: 'Could not create army book.'});
  }

});

router.post('/detachment', async (request, response) => {
  const { name, hint, gameSystemId, parentArmyBookId, clones, syncs } = request.body;

  // create new army book
  const newArmyBook = await armyBookService.createArmyBook(request.me.userId, [gameSystemId], name, hint);

  // fetch units from parent
  const parentArmyBook = await armyBookService.getArmyBookPublicOrOwner(parentArmyBookId, request.me.userId);

  // set units synced from parent
  const clonedAndSyncedUnits = parentArmyBook.units
    .filter((unit) => clones.includes(unit.id))
    .map((unit) => {
      let sync = undefined;
      if (syncs.includes(unit.id)) {
        sync = {
          parentArmyBookId,
          unitId: unit.id,
          syncAutomatic: true,
        };
      }
      return {
        ...unit,
        id: nanoid(7),
        clone: {
          parentArmyBookId,
          unitId: unit.id,
        },
        sync,
      };
    });

  await armyBookService.setUnits(newArmyBook.uid, request.me.userId, clonedAndSyncedUnits);

  // add upgrade packages
  let clonedUpgradePackages = [];
  clonedAndSyncedUnits.forEach(unit => clonedUpgradePackages.push(...unit.upgrades));
  const uniqueUpgradePackages = [ ...new Set(clonedUpgradePackages)];

  const upgradePackages = parentArmyBook.upgradePackages
    .filter((pck) => uniqueUpgradePackages.includes(pck.uid));
  await armyBookService.setUpgradePackages(newArmyBook.uid, request.me.userId, upgradePackages);

  // add special rules
  // TODO only used special rules
  await armyBookService.setSpecialRules(newArmyBook.uid, request.me.userId, parentArmyBook.specialRules)

  const updatedArmyBook = await armyBookService.getArmyBookPublicOrOwner(newArmyBook.uid, request.me.userId);

  response.status(200).json({...updatedArmyBook});
});

router.post('/import', async (request, response) => {
    const { isOpa, isAdmin }  = await userAccountService.getUserByUuid(request.me.userUuid);

  // only admins are allowed to upload
  if (isAdmin === false) {
    response.status(403).json({message: 'Your account does not allow to import army books.'});
    return;
  }

  let {
    name,
    hint,
    gameSystemId,
    background,
    versionString,
    units,
    upgradePackages,
    spells,
    specialRules,
    official,
    costModeAutomatic,
  } = request.body;

  // make all units match the requested cost mode
  units = units.map(unit => {
    unit.costMode = costModeAutomatic ? 'automatic' : 'manually';
    unit.costModeAutomatic = costModeAutomatic;

    unit.equipment.forEach((gear, index) => {
      // AF use label, but we use name
      // TODO remove once name can be used
      gear.name = gear.name || gear.label;
      //gear.name = pluralize.singular(gear.name); // we singularize any name
      gear.id = nanoid(5);
      if (gear.count && gear.count > 1 && !isNaN(gear.count)) {
        const count = gear.count;
        delete gear.count;
        for (let i = 1; i < count; i++) {
          let duplicate = {
            ...gear,
            id: nanoid(5),
          }
          unit.equipment.push(duplicate);
        }
      }
    });

    unit.equipment.sort((a, b) => {
      if (a.name > b.name) return 1;
      if (a.name < b.name) return -1;
    });

    return unit;
  })

  try {
    const { uid } = await armyBookService.createArmyBook(request.me.userId, [gameSystemId], name, hint, background);

    const updateSetFields = [];
    const updateSetValues = [];
    const data = request.body;
    ['version_string', 'official'].forEach((column) => {
      if(data[column] !== undefined) {
        updateSetFields.push(`${column} = $${updateSetFields.length+1}`);
        updateSetValues.push(data[column]);
      } else {
        console.info(`No entry found for ${column}`);
      }
    })
    // INFO disabled for now
    //await armyBookService.updateArmyBook(uid, request.me.userId, updateSetFields, updateSetValues);

    await armyBookService.setUnits(uid, request.me.userId, units);
    await armyBookService.setSpecialRules(uid, request.me.userId, specialRules);
    await armyBookService.setSpells(uid, request.me.userId, spells);
    await armyBookService.setUpgradePackages(uid, request.me.userId, upgradePackages);

    const armyBook = armyBookService.getArmyBookForOwner(uid, request.me.userId);

    response.status(200).json(armyBook);
  } catch (e) {
    console.error(e);
    response.status(400).json({e});
  }
});

/**
 * we return a flavored and (optional) skirmified army book
 */
router.get('/:armyBookUid~:gameSystemId', cors(), async (request, response) => {

  const { armyBookUid, gameSystemId } = request.params;
  const { armyForge } = request.query;

  let userId = request?.me?.userId || 0;

  // we fetch the source for further handling
  let armyBook = await armyBookService.getArmyBookPublicOrOwner(armyBookUid, userId);

  if (armyBook && armyBook.enabledGameSystems.includes(parseInt(gameSystemId))) {

    // we overwrite with our pseudo xxx-skirmish id
    // armyBook.uid = armyBookUid;

    if ([3,5].includes(parseInt(gameSystemId))) {
      armyBook = skirmificationService.skirmify(armyBook);
    }

    // add flavor
    const gameSystem = await gameSystemService.getGameSystemById(gameSystemId);
    if (gameSystem) {
      armyBook.gameSystemId = gameSystem.id;
      armyBook.gameSystemSlug = gameSystem.slug;
      armyBook.fullname = gameSystem.fullname;
      armyBook.aberration = gameSystem.aberration;
      armyBook.universe = gameSystem.universe;
      armyBook.shortname = gameSystem.shortname;
      armyBook.flavouredUid = `${armyBook.uid}~${gameSystemId}`;
    } else {
      console.warn(`No GameSystem found for gameSystem=${gameSystemId}.`);
    }

    if (armyForge) {
      try {
        armyBook = DataParsingService.transformApiData(armyBook);
        if (!armyBook) {
          response.status(400).json({ message: 'Could not transform army book' });
          return;
        }
      }
      catch (e) {
        console.error(e);
        response.status(400).json({ message: 'Could not transform army book' });
      }
    }

    response.set('Cache-Control', 'public, max-age=60'); // 1 minute
    response.status(200).json(armyBook);
    //response.set('Last-Modified', new Date(armyBook.modifiedAt).toUTCString());
    //return response.send({...armyBook, units});

  } else {
    response.status(404).json({});
  }

});

router.get('/:armyBookUid', cors(), async (request, response) => {

  console.info('/:armyBookUid')
  const { armyBookUid } = request.params;
  let userId = request?.me?.userId || 0;

  // we fetch the source for further handling
  const armyBook = await armyBookService.getArmyBookPublicOrOwner(armyBookUid, userId);

  if (armyBook) {

    // enrich unit missing splitPageNumber
    armyBook.units = armyBook.units.map(unit => {
      return {
        ...unit,
        splitPageNumber: parseInt(unit.splitPageNumber) || 1,
      }
    });

    response.set('Cache-Control', 'public, max-age=0'); // 1 minute
    response.status(200).json(armyBook);
    //response.set('Last-Modified', new Date(armyBook.modifiedAt).toUTCString());
    //return response.send({...armyBook, units});

  } else {
    response.status(404).json({});
  }

});

router.get('/:armyBookUid/pdf', cors(), async (request, response) => {

  const { armyBookUid } = request.params;
  let unflavoredArmyBookUid = armyBookUid;
  let userId = request?.me?.userId || 0;

  if (armyBookUid.indexOf('~') >= 0) {
    const split = armyBookUid.split('~');
    unflavoredArmyBookUid = split[0];
  }

  const armyBook = await armyBookService.getArmyBookPublicOrOwner(unflavoredArmyBookUid, userId);

  if (!armyBook) {
    response.status(404).json({});
  } else {

    let pdfByteArray = undefined;

    let pdf = await armyBookService.readPdfA4(armyBookUid);

    if (pdf && pdf.createdAt) {
      if (new Date(pdf.createdAt).toISOString() == new Date(armyBook.modifiedAt).toISOString()) {
        pdfByteArray = pdf.byteArray;
      }
    }

    if (!pdfByteArray) {

      console.info(`[${armyBook.name}]#${armyBook.uid} :: No PDF found since ${armyBook.modifiedAt}. Fetching ${armyBookUid} from service provider...`);

      const res = await pdfService.generateViaHtml2pdf(armyBookUid);
      //const res = await pdfService.generateViaSejda(armyBookUid);

      if (res) {
        pdfByteArray = res.data;
        console.info(`[${armyBook.name}] #${armyBook.uid} :: Save pdf, ${pdfByteArray.length} bytes ...`);
        await armyBookService.savePdfA4(armyBookUid, pdfByteArray, new Date(armyBook.modifiedAt.toISOString()), 'Html2pdf');
      } else {
        console.error(`[${armyBook.name}] #${armyBook.uid} :: PDF could not be generated!`);
      }

    } else {
      console.info(`[${armyBook.name}] #${armyBook.uid} :: PDF found.`);
    }

    response.setHeader('Content-Type', 'application/pdf');
    const pdfFileName = `${armyBook.aberration} - ${armyBook.name} ${armyBook.versionString}`;
    response.setHeader('Content-Disposition', `inline; filename="${pdfFileName}.pdf"`);
    response.setHeader('Content-Transfer-Encoding', 'binary');
    response.setHeader('Accept-Ranges', 'bytes');
    response.set('Cache-Control', 'public, max-age=60'); // 1 minute
    response.send(pdfByteArray);
  }
});

router.get('/:armyBookUid/mine', async (request, response) => {
  const { armyBookUid } = request.params;

  const armyBook = await armyBookService.getArmyBookForOwner(armyBookUid, request.me.userId);

  if (!armyBook) {
    response.status(404).json({message: 'Not found or no ownership'});
  } else {
    const units = armyBook.units.map(unit => {
      return {
        ...unit,
        splitPageNumber: parseInt(unit.splitPageNumber) || 1,
      };
    });
    response.status(200).json({...armyBook, units});
  }

});

router.get('/:armyBookUid/ownership', async (request, response) => {
  const { armyBookUid } = request.params;

  const armyBook = await armyBookService.getSimpleArmyBook(armyBookUid);

  if (!armyBook) {
    response.status(404).json({message: 'Not found.'});
  }

  if (armyBook.userId !== request.me.userId) {
    response.status(403).json({message: 'Permission required.'});
  } else {
    response.status(200).json({...armyBook});
  }

});

router.post('/:armyBookUid/calculate', async (request, response) => {
  const { isOpa, isAdmin }  = await userAccountService.getUserByUuid(request.me.userUuid);

  // only admins are allowed to recalculate
  if (isAdmin === false) {
    response.status(403).json({message: 'Your account does not allow to import army books.'});
    return;
  }

  const { armyBookUid } = request.params;

  try {
    const armyBook = await armyBookService.getArmyBookForOwner(armyBookUid, request.me.userId);

    let { units, upgradePackages, specialRules } = armyBook;
    const customRules = CalcHelper.toCustomRules(specialRules);

    const unitz = units.map(unit => {
      if (unit.costModeAutomatic) {
        const originalUnit = CalcHelper.normalizeUnit(unit);
        const unitCost = calc.unitCost(originalUnit, customRules);
        const cost = CalcHelper.round(unitCost);
        return {
          ...unit,
          cost,
        };
      } else {
        return unit;
      }
    });
    await unitService.updateUnits(armyBookUid, request.me.userId, unitz);

    const upgradePackagez = [];
    for (const pack of upgradePackages) {
      const usingUnits = unitz.filter(unit => unit.upgrades.includes(pack.uid));
      const recalcedOptions = CalcHelper.recalculateUpgradePackage(armyBookUid, pack, usingUnits, calc, customRules);
      for (const payload of recalcedOptions) {
        const { armyBookUid, upgradePackageUid, sectionIndex, optionIndex, option } = payload;
        pack.sections[sectionIndex].options[optionIndex] = option;
      }
      upgradePackagez.push(pack);
    }
    await upgradePackagesService.updateUpgradePackages(armyBookUid, request.me.userId, upgradePackagez);

    response.status(200).json({ units: unitz, upgradePackages: upgradePackagez});
  } catch (e) {
    console.error(e);
    response.status(400).json({message: 'could not calculate unit costs'});
  }
});

router.patch('/:armyBookUid', async (request, response) => {
  const { armyBookUid } = request.params;
  const data = request.body

  const patchableColumns = [
    'version_string',
    'name',
    'background',
    'hint',
    'cover_image_path',
    'cover_image_credit',
    'is_live',
    'public',
    'official',
    'enabled_game_systems',
  ];
  const updateSetFields = [];
  const updateSetValues = [];
  patchableColumns.forEach((column) => {
    if(data[column] !== undefined) {
      updateSetFields.push(`${column} = $${updateSetFields.length+1}`);
      updateSetValues.push(data[column]);
    } else {
      console.info(`No entry found for ${column}`);
    }
  })

  try {
    await armyBookService.updateArmyBook(armyBookUid, request.me.userId, updateSetFields, updateSetValues)
    response.status(204).json();
  } catch (e) {
    console.warn(e)
    response.status(500).json({message: 'Could not update armybook'});
  }

});

router.delete('/:armyBookUid', async (request, response) => {
  const { armyBookUid } = request.params;

  await armyBookService.deleteArmyBook(armyBookUid, request.me.userId);

  response.status(204).json();
});

export default router;
