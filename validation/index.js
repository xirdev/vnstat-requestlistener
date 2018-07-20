import Moment from 'moment';
import ValidateJs from 'validate.js';

import cloneDeep from 'lodash-es/cloneDeep';

export default ValidateJs;

const baseConstraints = {
  'startDate': {
    presence: {
      allowEmpty: false
    },
    datetime:        {
      earliest: '2018-01-01',
    }
  },
  'stopDate':  {
    datetime:        {
      earliest: '2018-01-01',
    },
    requirePresence: {
      attributes: [
        'startDate'
      ],
      allowEmpty: false
    },
    relationalOperator: {
      attributes: {
        'startDate': {
          operator: 'greaterThan'
        }
      },
    }
  }
};

export const yearConstraints = cloneDeep(baseConstraints);
export const monthConstraints = cloneDeep(baseConstraints);
export const dayConstraints = cloneDeep(baseConstraints);
export const hourConstraints = cloneDeep(baseConstraints);

// use Moment to parse/format our DateTimes
// always use UTC and ISO 8601
ValidateJs.extend(ValidateJs.validators.datetime, {
  parse: (value, _options) => {
    if (!value) {
      return NaN;
    }
    // milliseconds since unix epoch
    return Moment.utc(value).valueOf();
  },
  format: (value, options) => {
    let formatStr = options.dateOnly
                    ? 'YYYY-MM-DD'
                    : 'YYYY-MM-DD[T]HH:mm:ss[Z]';
    return Moment.utc(value).format(formatStr);
  }
});

// simple validator to bind two attributes together
// if one is present, the other must be present
ValidateJs.validators.requirePresence = (value, options, _attribute, attributes, _globalOptions) => {

  // Empty values are fine
  if (!ValidateJs.isDefined(value)) {
    return;
  }

  // no attributes were specified
  if (!options.attributes || options.attributes.length === 0) {
    return;
  }

  const presenceOptions = {
    allowEmpty: options.allowEmpty
  };

  let invalidAttributes = [];
  for (const otherAttribute of options.attributes) {
    let otherValidation = ValidateJs.validators.presence(attributes[otherAttribute], presenceOptions);
    if (otherValidation) {
      invalidAttributes.push(otherAttribute);
    }
  }

  if (invalidAttributes.length > 0) {
    return `requires the presence of ${invalidAttributes.join()}`;
  }

  // we passsed
  return null;
};

ValidateJs.validators.relationalOperator = (value, options, _attribute, attributes, _globalOptions) => {

  // Empty values are fine
  if (!ValidateJs.isDefined(value)) {
    return;
  }

  let attributesEntries = Object.entries(options.attributes);
  // no attributes were specified
  if (!options.attributes || attributesEntries.length === 0) {
    return;
  }

  let invalidAttributes = [];
  for (const [otherAttribute, otherOptions] of attributesEntries) {
    let operator = otherOptions.operator;
    let otherAttributeValue = attributes[otherAttribute];
    switch (operator) {
      case 'lessThan':
      case '<':
        if (!(value < otherAttributeValue)) {
          invalidAttributes.push({
            attribute: otherAttribute,
            operator
          });
        }
        break;
      case 'lessThanOrEqual':
      case '<=':
        if (!(value <= otherAttributeValue)) {
          invalidAttributes.push({
            attribute: otherAttribute,
            operator
          });
        }
        break;
      case 'greaterThan':
      case '>':
        if (!(value > otherAttributeValue)) {
          invalidAttributes.push({
            attribute: otherAttribute,
            operator
          });
        }
        break;
      case 'greaterThanOrEqual':
      case '>=':
        if (!(value >= otherAttributeValue)) {
          invalidAttributes.push({
            attribute: otherAttribute,
            operator
          });
        }
        break;
      default:
        break;
    }
  }

  if (invalidAttributes.length > 0) {
    return `::${invalidAttributes.map(other => {
      return ` required to be ${other.operator} ${other.attribute}.`;
    })}`;
  }

  // we passsed
  return null;
};
