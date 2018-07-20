import Moment from 'moment';
import ValidateJs, * as RequestConstraints from './validation';

import { parse as urlParse } from 'url';
import { exec as processExec } from 'child_process';
import jsonBody from 'body/json';

const DEFAULT_PATH_PREFIX = '/vnstat';

export default class VnStatListener {

  constructor(apiPath) {

    apiPath = apiPath || DEFAULT_PATH_PREFIX;
    while (apiPath.endsWith('/')) {
      apiPath = apiPath.substring(0, apiPath.length - 1);
    }
    if (!apiPath) {
      apiPath = DEFAULT_PATH_PREFIX;
    }

    this.apiPath = apiPath;

    return this.requestListener();
  }

  requestListener() {
    return (req, res) => {

      let urlObj = urlParse(req.url);

      if (urlObj.pathname !== this.apiPath && !urlObj.pathname.startsWith(`${this.apiPath}/`)) {
        // we won't be handling this request at all
        return;
      }

      // claim ownership of request ASAP, downstream requestListeners will know to ignore
      req.requestHandled = true;

      let validationConstraints;
      let momentUnitOfTime;
      let momentFormatStr;
      let vnStatMode;
      let vnStatUnitOfTime;
      let datePrecision;

      switch (urlObj.pathname) {
        case `${this.apiPath}/years`:

          validationConstraints = RequestConstraints.yearConstraints;
          momentUnitOfTime      = 'year';
          momentFormatStr       = 'YYYY-MM-DD';
          // vnstat doesn't technically have years, we just use months and reduce down
          vnStatMode            = 'm';
          vnStatUnitOfTime      = 'months';
          datePrecision         = 'Year';
          executeVnStatRequest(req, res, validationConstraints, momentUnitOfTime, momentFormatStr, vnStatMode, vnStatUnitOfTime, datePrecision);

          break;
        case `${this.apiPath}/months`:

          validationConstraints = RequestConstraints.monthConstraints;
          momentUnitOfTime      = 'month';
          momentFormatStr       = 'YYYY-MM-DD';
          vnStatMode            = 'm';
          vnStatUnitOfTime      = 'months';
          datePrecision         = 'Month';
          executeVnStatRequest(req, res, validationConstraints, momentUnitOfTime, momentFormatStr, vnStatMode, vnStatUnitOfTime, datePrecision);

          break;
        case `${this.apiPath}/days`:

          validationConstraints = RequestConstraints.dayConstraints;
          momentUnitOfTime      = 'day';
          momentFormatStr       = 'YYYY-MM-DD';
          vnStatMode            = 'd';
          vnStatUnitOfTime      = 'days';
          datePrecision         = 'Day';
          executeVnStatRequest(req, res, validationConstraints, momentUnitOfTime, momentFormatStr, vnStatMode, vnStatUnitOfTime, datePrecision);

          break;
        case `${this.apiPath}/hours`:

          validationConstraints = RequestConstraints.hourConstraints;
          momentUnitOfTime      = 'hour';
          momentFormatStr       = 'YYYY-MM-DD[T]HH:00:00[Z]';
          vnStatMode            = 'h';
          vnStatUnitOfTime      = 'hours';
          datePrecision         = 'Hour';
          executeVnStatRequest(req, res, validationConstraints, momentUnitOfTime, momentFormatStr, vnStatMode, vnStatUnitOfTime, datePrecision);

          break;
        default:

          // because we are taking full responsibility of handling request, we will return 404
          res.statusCode = 404;
          res.end();
          break;
      }

    };
  }
}

function executeVnStatRequest(req, res, validationConstraints, momentUnitOfTime, momentFormatStr, vnStatMode, vnStatUnitOfTime, datePrecision) {
  jsonBody(req, res, (err, body) => {
    if (err) {
      clientErrorResponse(res, err);
      return;
    }

    let validateResult = ValidateJs.validate(body, validationConstraints);
    if (validateResult) {
      clientErrorResponse(res, validateResult);
      return;
    }

    let startDate = Moment.utc(body['startDate']).startOf(momentUnitOfTime);
    let stopDate = null;
    let isRange = false;
    if (body['stopDate']) {
      // stopDate isn't always required
      stopDate = Moment.utc(body['stopDate']).startOf(momentUnitOfTime);
      isRange = true;
    }

    let processOptions = {};
    processExec(`vnstat --json ${vnStatMode}`, processOptions, (err, stdout, _stderr) => {
      if (err) {
        serverErrorResponse(res, err);
        return;
      }

      let vnStatJson = JSON.parse(stdout);
      // insert moment objects into individual parts of arr (easier filtering/sorting later)
      vnStatJson['interfaces'].forEach((intf) => {
        intf['traffic'][vnStatUnitOfTime].forEach((trafficData) => {
          let date = Object.assign({}, trafficData['date']);
          // Moment uses zero ordered months
          date['month']--;
          // also if we are utilizing hours, the hour is the id key
          if (vnStatUnitOfTime === 'hours') {
            date['hour'] = trafficData['id'];
          }
          trafficData['moment'] = Moment.utc(date);
        });
      });

      let usedTrafficData;
      if (isRange) {

        usedTrafficData = vnStatJson['interfaces'].reduce((intfAcc, intf) => {

          intf['traffic'][vnStatUnitOfTime]
            .filter((trafficData) => trafficData['moment'].isBetween(startDate, stopDate, momentUnitOfTime, '[)'))
            .sort((a, b) => a['moment'].diff(b['moment']))
            .map(({ rx, tx, moment }) => {
              return { rx, tx, date: moment.startOf(momentUnitOfTime).format(momentFormatStr) };
            })
            .forEach(({ rx, tx, date }) => {
              if (intfAcc[date]) {
                // accumulate data between interfaces on same date (key)
                intfAcc[date].rx += rx;
                intfAcc[date].tx += tx;
              } else {
                // set new trafficData
                intfAcc[date] = { rx, tx };
              }
            });

          return intfAcc;

        }, {});

      } else {

        usedTrafficData = vnStatJson['interfaces'].reduce((intfAcc, intf) => {

          let usedData = intf['traffic'][vnStatUnitOfTime]
            .filter((trafficData) => trafficData['moment'].isSame(startDate, momentUnitOfTime))
            .map(({ rx, tx }) => {
              return { rx, tx };
            })
            .reduce((acc, cur) => {
              acc.rx += cur.rx;
              acc.tx += cur.tx;
              return acc;
            }, { rx: 0, tx: 0 });

          let date = startDate.format(momentFormatStr);
          if (intfAcc[date]) {
            // accumulate data between interfaces on same date
            intfAcc[date].rx += usedData.rx;
            intfAcc[date].tx += usedData.tx;
          } else {
            // set new trafficData
            intfAcc[date] = usedData;
          }

          return intfAcc;

        }, {});
      }

      let response = {
        traffic: usedTrafficData,
        precision: datePrecision,
        startDate: startDate.format(momentFormatStr)
      };
      if (isRange) {
        response.stopDate = stopDate.format(momentFormatStr);
      }

      successResponse(res, response);
    });
  });
}

function successResponse(res, payload) {
  rawResponse(res, 200, payload);
}

function clientErrorResponse(res, error) {
  rawResponse(res, 400, error);
}

function serverErrorResponse(res, error) {
  rawResponse(res, 500, error);
}

function rawResponse(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  let body = typeof payload === 'string'
             ? payload
             : JSON.stringify(payload);
  res.end(body);
}
