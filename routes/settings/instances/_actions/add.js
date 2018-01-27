import { getAccessTokenFromAuthCode, registerApplication, generateAuthLink } from '../../../_utils/mastodon/oauth'
import { getVerifyCredentials } from '../../../_utils/mastodon/user'
import { getInstanceInfo } from '../../../_utils/mastodon/instance'
import { goto } from 'sapper/runtime.js'
import { switchToTheme } from '../../../_utils/themeEngine'
import { database } from '../../../_utils/database/database'
import { store } from '../../../_utils/store'

const REDIRECT_URI = (typeof location !== 'undefined' ?
  location.origin : 'https://pinafore.social') + '/settings/instances/add'

store.onchange((state, changed) => {
  if (changed['instanceNameInSearch']) {
    store.set({logInToInstanceError: false})
  }
})

async function redirectToOauth() {
  let instanceName = store.get('instanceNameInSearch')
  let loggedInInstances = store.get('loggedInInstances')
  instanceName = instanceName.replace(/^https?:\/\//, '').replace('/$', '')
  if (Object.keys(loggedInInstances).includes(instanceName)) {
    store.set({logInToInstanceError: `You've already logged in to ${instanceName}`})
    return
  }
  let registrationPromise = registerApplication(instanceName, REDIRECT_URI)
  let instanceInfo = await getInstanceInfo(instanceName)
  await database.setInstanceInfo(instanceName, instanceInfo) // cache for later
  let instanceData = await registrationPromise
  store.set({
    currentRegisteredInstanceName: instanceName,
    currentRegisteredInstance: instanceData
  })
  store.save()
  let oauthUrl = generateAuthLink(
    instanceName,
    instanceData.client_id,
    REDIRECT_URI
  )
  document.location.href = oauthUrl
}

export async function logInToInstance() {
  store.set({logInToInstanceLoading: true})
  try {
    await redirectToOauth()
  } catch (err) {
    console.error(err)
    let error = `${err.message || err.name}. ` +
      (navigator.onLine ?
        `Is this a valid Mastodon instance?` :
        `Are you offline?`)
    store.set({logInToInstanceError: error})
  } finally {
    store.set({logInToInstanceLoading: false})
  }
}

async function registerNewInstance(code) {
  let currentRegisteredInstanceName = store.get('currentRegisteredInstanceName')
  let currentRegisteredInstance = store.get('currentRegisteredInstance')
  let instanceData = await getAccessTokenFromAuthCode(
    currentRegisteredInstanceName,
    currentRegisteredInstance.client_id,
    currentRegisteredInstance.client_secret,
    code,
    REDIRECT_URI
  )
  let loggedInInstances = store.get('loggedInInstances')
  let loggedInInstancesInOrder = store.get('loggedInInstancesInOrder')
  let instanceThemes = store.get('instanceThemes')
  instanceThemes[currentRegisteredInstanceName] = 'default'
  loggedInInstances[currentRegisteredInstanceName] = instanceData
  if (!loggedInInstancesInOrder.includes(currentRegisteredInstanceName)) {
    loggedInInstancesInOrder.push(currentRegisteredInstanceName)
  }
  store.set({
    instanceNameInSearch: '',
    currentRegisteredInstanceName: null,
    currentRegisteredInstance: null,
    loggedInInstances: loggedInInstances,
    currentInstance: currentRegisteredInstanceName,
    loggedInInstancesInOrder: loggedInInstancesInOrder,
    instanceThemes: instanceThemes
  })
  store.save()
  switchToTheme('default')
  // fire off request for account so it's cached
  getVerifyCredentials(currentRegisteredInstanceName, instanceData.access_token).then(verifyCredentials => {
    database.setInstanceVerifyCredentials(currentRegisteredInstanceName, verifyCredentials)
  })
  goto('/')
}

export async function handleOauthCode(code) {
  try {
    store.set({logInToInstanceLoading: true})
    await registerNewInstance(code)
  } catch (err) {
    store.set({logInToInstanceError: `${err.message || err.name}. Failed to connect to instance.`})
  } finally {
    store.set({logInToInstanceLoading: false})
  }
}

