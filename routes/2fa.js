const insecurity = require('../lib/insecurity')
const models = require('../models/')
const otplib = require('otplib')
const utils = require('../lib/utils')
const logger = require('../lib/logger')
const challenges = require('../data/datacache').challenges
const config = require('config')

otplib.authenticator.options = {
  // Accepts tokens as valid even when they are 30sec to old or to new
  // This is a standard as the clocks of the authenticator and server might not align perfectly.
  window: 1
}

async function verify (req, res) {
  const { tmpToken, totpToken } = req.body

  try {
    const { userId, type } = insecurity.verify(tmpToken)

    if (type !== 'password_valid_needs_second_factor_token') {
      throw new Error('Invalid token type')
    }

    const user = await models.User.findByPk(userId)

    const isValid = otplib.authenticator.check(totpToken, user.totpSecret)

    const plainUser = utils.queryResultToJson(user)

    if (!isValid) {
      return res.status(401).send()
    }

    if (utils.notSolved(challenges.twoFactorAuthUnsafeSecretStorageChallenge) && user.email === 'wurstbrot@' + config.get('application.domain')) {
      utils.solve(challenges.twoFactorAuthUnsafeSecretStorageChallenge)
    }

    const [ basket ] = await models.Basket.findOrCreate({ where: { userId }, defaults: {} })

    const token = insecurity.authorize(plainUser)
    plainUser.bid = basket.id // keep track of original basket for challenge solution check
    insecurity.authenticatedUsers.put(token, plainUser)

    res.json({ authentication: { token, bid: basket.id, umail: user.email } })
  } catch (error) {
    logger.warn('Failed to verify token identity')
    res.status(401).send()
  }
}

/**
 * Check the 2FA status of the currently signed in user.
 *
 * When 2FA isnt setup, the result will include data requried to start the setup.
 */
async function status (req, res) {
  const data = insecurity.authenticatedUsers.from(req)
  if (!data) {
    res.status(401).send('You need to be logged in to see this.')
    return
  }
  const { data: user } = data

  if (user.totpSecret === '') {
    const secret = await otplib.authenticator.generateSecret()

    res.json({
      setup: false,
      secret,
      email: user.email,
      setupToken: insecurity.authorize({
        secret,
        type: 'totp_setup_secret'
      })
    })
  } else {
    res.json({
      setup: true
    })
  }
}

/**
 * Sets Up 2FA for a User
 * Requires 3 params:
 * 1. The Users Password as a confirmation.
 * 2. A Setup token. This is returned by the status endpoint.
 *    This containes a signed TOTP secret to ensure that the secret
 *    was generated by the server and wasnt tampered with by the client
 * 3. The first TOTP Token, generated by the TOTP App. (e.g. Google Authenticator)
 */
async function setup (req, res) {
  const data = insecurity.authenticatedUsers.from(req)
  if (!data) {
    res.status(401).send('You need to be logged in to see this.')
    return
  }
  const { data: user } = data

  const { password, setupToken, initalToken } = req.body

  if (user.password !== insecurity.hash(password)) {
    res.status(401).send()
    return
  }

  try {
    const { secret, type } = insecurity.verify(setupToken)

    if (type !== 'totp_setup_secret') {
      res.status(401).send()
      return
    }

    if (!otplib.authenticator.check(initalToken, secret)) {
      res.status(401).send()
      return
    }

    // Update db model and cached object
    const userModel = await models.User.findByPk(user.id)
    userModel.totpSecret = secret
    await userModel.save()
    insecurity.authenticatedUsers.updateFrom(req, utils.queryResultToJson(userModel))

    res.status(200).send()
  } catch (error) {
    res.status(401).send()
  }
}

module.exports.verify = () => verify
module.exports.status = () => status
module.exports.setup = () => setup
