import Router from 'express-promise-router';
import cors from 'cors';
import axios from 'axios';
import { nanoid } from 'nanoid';
import pluralize from 'pluralize';

import * as armyBookService from './army-book-service';
import * as upgradePackagesService from './upgradePackages/upgrade-packages-service';
import * as unitService from './units/unit-service';
import userAccountService from '../auth/user-account-service';

import units from './units';
import upgradePackages from './upgradePackages';
import specialRules from './specialRules';
import spells from './spells';
import {CalcHelper} from "opr-army-book-helper";
import calc from "opr-point-calculator-lib";

const router = new Router();

router.use('/:armyBookUid/units', units);
router.use('/:armyBookUid/upgrade-packages', upgradePackages);
router.use('/:armyBookUid/special-rules', specialRules);
router.use('/:armyBookUid/spells', spells);

router.get('/', cors(), async (request, response) => {

  const { gameSystemSlug } = request.query;

  // all original army books for this system
  let items = await armyBookService.getPublicArmyBooksListView(gameSystemSlug);

  if (['grimdark-future-firefight', 'age-of-fantasy-skirmish'].includes(gameSystemSlug)) {

    const { isOpa, isAdmin }  = await userAccountService.getUserByUuid(request.me.userUuid);
    if (isAdmin) {
      let parentSlug = 'grimdark-future';
      if (gameSystemSlug === 'age-of-fantasy-skirmish') {
        parentSlug = 'age-of-fantasy';
      }

      let skirmish = await armyBookService.getPublicArmyBooksListView(parentSlug);
      skirmish = skirmish.map(armyBook => {
        armyBook.uid = `${armyBook.uid}-skirmish`;
        // TODO set this respectively and filter
        armyBook.enableForSkirmish = true;
        return armyBook;
      }).filter(armyBook => armyBook.enableForSkirmish === true);
      items.push(...skirmish);
    }
  }

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

  const armyBook = await armyBookService.createArmyBook(request.me.userId, gameSystemId, name, hint, background);

  if (armyBook) {
    response.status(200).json(armyBook);
  } else {
    response.status(400).json({message: 'Could not create army book.'});
  }

});

router.post('/detachment', async (request, response) => {
  const { name, hint, gameSystemId, parentArmyBookId, clones, syncs } = request.body;

  // create new army book
  const newArmyBook = await armyBookService.createArmyBook(request.me.userId, gameSystemId, name, hint);

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
    const { uid } = await armyBookService.createArmyBook(request.me.userId, gameSystemId, name, hint, background);

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

router.get('/:armyBookUid', cors(), async (request, response) => {

  const { armyBookUid } = request.params;
  let originArmyBookUid = armyBookUid;
  let minify = false;
  let userId = request?.me?.userId || 0;

  if (armyBookUid.endsWith('-skirmish')) {
    originArmyBookUid = armyBookUid.split('-skirmish')[0];
    minify = true;
  }

  // we fetch the source for further handling
  const armyBook = await armyBookService.getArmyBookPublicOrOwner(originArmyBookUid, userId);

  if (armyBook) {

    // we overwrite with our pseudo xxx-skirmish id
    armyBook.uid = armyBookUid;

    // enrich unit missing splitPageNumber
    armyBook.units = armyBook.units.map(unit => {
      return {
        ...unit,
        splitPageNumber: parseInt(unit.splitPageNumber) || 1,
      }
    });

    // TODO check if this book is allowed to minify
    if (minify === true) {

      armyBook.units = armyBook.units.map(unit => {

        let originalUnit = CalcHelper.normalizeUnit(unit);
        originalUnit.models = 1;
        const cost = calc.unitCost(originalUnit);
        if (cost >= 100) {
          // we discard this unit later
          unit.size = 1;
        } else if (cost < 15) {
          unit.size = 3;
        } else if (cost < 5) {
          unit.size = 5;
        } else {
          unit.size = 1;
        }

        // reset the new size to compute the final cost
        originalUnit.models = unit.size;
        unit.cost = CalcHelper.round(calc.unitCost(originalUnit));

        // We remove some common sufixes that do not make sense for unit size 1
        if (unit.size === 1) {
          unit.name = unit.name.replace(' Squad', ''); // see HDF
          unit.name = unit.name.replace(' Squads', ''); // see HDF
          unit.name = unit.name.replace(' Mob', ''); // see Orc Marauders
        }

        // Pluralize according to unit size
        unit.name = pluralize(unit.name, unit.size);

        // Ensure unit equipment is named with the unit.size in mind
        unit.equipment = unit.equipment.map(weapon => {
          const name = weapon.name || weapon.label;
          weapon.name = pluralize(name, unit.size);
          weapon.label = pluralize(name, unit.size);
          return weapon;
        });

        // We assume, that for Skirmish, all units fit on a single page
        unit.splitPageNumber = 1;

        return unit;
      })
        .filter(unit => unit.cost < 100) // discard units with rounded cost >= 100
        .filter(unit => unit.specialRules.every(sr => sr.key !== 'artillery')); // discard units with rule 'artillery'

      armyBook.specialRules = armyBook.specialRules.map(sr => {
        // TODO check remaining exceptions
        sr.description = sr.description.replace('The hero and its unit', 'This model and all friendly units within 12"');
        sr.description = sr.description.replace('This model and its unit', 'This model and all friendly units within 12"');
        sr.description = sr.description.replace(/If the hero is part of a unit of (.*), the unit counts/, 'All friendly units of $1 within 12" count');
        return sr;
      });

      // Beautify names due to units with size 1
      armyBook.upgradePackages = armyBook.upgradePackages.map(pack => {
        const usingUnits = armyBook.units.filter(unit => unit.upgrades.includes(pack.uid));
        const sizes = usingUnits.map(unit => unit.size);
        const maxSize = Math.max(...sizes);
        if (maxSize === 1) {
          pack.sections = pack.sections.map(section => {
            // TODO check how 'any' can be renamed better
            section.label = section.label.replace('Replace one', 'Replace');
            section.label = section.label.replace('Replace all', 'Replace');
            section.label = section.label.replace(/Replace up to \w+/, 'Replace');
            section.label = section.label.replace(/Replace with up to \w+/, 'Replace');
            section.label = section.label.replace('Upgrade one model', 'Upgrade');
            section.label = section.label.replace('Upgrade all models', 'Upgrade');
            section.label = section.label.replace('Upgrade any model', 'Upgrade');
            section.label = pluralize(section.label, 1);
            return section;
          });
        }
        return pack;
      });

      // TODO merge sections within package with same label (e.g. Replace <weapon>
      // group by section label

      // Recalculate costs for upgrade packages
      armyBook.upgradePackages = armyBook.upgradePackages.map(pack => {
        const usingUnits = armyBook.units.filter(unit => unit.upgrades.includes(pack.uid));
        const recalcedOptions = CalcHelper.recalculateUpgradePackage(armyBookUid, pack, usingUnits, calc, {});
        for (const payload of recalcedOptions) {
          const {armyBookUid, upgradePackageUid, sectionIndex, optionIndex, option} = payload;
          pack.sections[sectionIndex].options[optionIndex] = option;
        }
        return pack;
      });

      // We remove upgrade options that cost >= 50
      armyBook.upgradePackages = armyBook.upgradePackages
        .map(pack => {
          pack.sections = pack.sections.map(section => {
            section.options = section.options.filter(option => option.cost < 50);
            return section;
          })
        // discard sections with options that are empty
        .filter(section => section.options.length > 0)
        // discard sections with add <> model -> Add one model with
        .filter(section => section.label.startsWith('Add one model with') === false);

        return pack;
      });

      // todo enrich with correct meta data

      armyBook.autogenerated = true;
      armyBook.aberration = 'GFF';
    }

    response.set('Cache-Control', 'public, max-age=60'); // 1 minute
    response.status(200).json(armyBook);
    //response.set('Last-Modified', new Date(armyBook.modifiedAt).toUTCString());
    //return response.send({...armyBook, units});

  } else {
    response.status(404).json({});
  }

});

router.get('/:armyBookUid/pdf', cors(), async (request, response) => {

  const { armyBookUid } = request.params;
  let originArmyBookUid = armyBookUid;
  let minify = false;
  let userId = request?.me?.userId || 0;

  if (armyBookUid.endsWith('-skirmish')) {
    originArmyBookUid = armyBookUid.split('-skirmish')[0];
    minify = true;
  }

  const armyBook = await armyBookService.getArmyBookPublicOrOwner(originArmyBookUid, userId);

  if (!armyBook) {
    response.status(404).json({});
  } else {

    let pdfByteArray = await armyBookService.readPdfA4(armyBookUid);

    if (!pdfByteArray) {

      console.info(`[${armyBook.name}]#${armyBook.uid} :: No PDF found since ${armyBook.modifiedAt}. Fetching from serice provider...`);

      const params = {
        url: `https://webapp.onepagerules.com/army-books/view/${armyBookUid}/print`,
        apiKey: process.env.HTML2PDF_API_KEY,
        media: 'print',
      };
      const res = await axios.get('https://api.html2pdf.app/v1/generate',
        {
          params: params,
          responseType: 'arraybuffer',
        },
      );
      pdfByteArray = res.data;
      console.info(`[${armyBook.name}]#${armyBook.uid} :: Save pdf bytes ${pdfByteArray.length}...`);
      await armyBookService.savePdfA4(armyBookUid, pdfByteArray, new Date(armyBook.modifiedAt.toISOString()));
    } else {
      console.info(`[${armyBook.name}]#${armyBook.uid} :: PDF found.`);
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
    'official',
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
