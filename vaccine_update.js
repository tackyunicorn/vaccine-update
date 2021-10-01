const _ = require("lodash");
const request = require("request");
const moment = require("moment");

const district = "Ernakulam";
const webhook_url = "";

const get_cowin_url = () =>
  `https://cdn-api.co-vin.in/api/v2/appointment/sessions/public/calendarByDistrict?district_id=${
    district_id[district]
  }&date=${moment().startOf("day").add(1, "day").format("DD-MM-YYYY")}`;

const district_id = {
  Alappuzha: 301,
  Ernakulam: 307,
  Idukki: 306,
  Kannur: 297,
  Kasaragod: 295,
  Kollam: 298,
  Kottayam: 304,
  Kozhikode: 305,
  Malappuram: 302,
  Palakkad: 308,
  Pathanamthitta: 300,
  Thiruvananthapuram: 296,
  Thrissur: 303,
  Wayanad: 299,
};

const tracker = {
  previous: {
    centers: [],
    message: "",
    time: moment(),
  },
  duration: {
    hearbeat: 60, // minutes
    cache: 10, // minutes
    polling: 20, // seconds
  },
};

const get_vaccine_centers = () => {
  const cowin_options = {
    url: get_cowin_url(),
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  };

  return new Promise((resolve, reject) => {
    request(cowin_options, (error, response) => {
      if (error) {
        reject(error);
      } else {
        if (!_.isEqual(response.statusCode, 200))
          reject(JSON.parse(response.body));
        resolve(JSON.parse(response.body));
      }
    });
  });
};

const post_to_webhook = (message = "Failed to process message") => {
  const webhook_options = {
    method: "POST",
    url: webhook_url,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: message,
    }),
  };

  return new Promise((resolve, reject) => {
    request(webhook_options, (error, response) => {
      if (error) {
        reject(error);
      } else {
        if (!_.isEqual(response.statusCode, 200)) reject(response.body);
        console.log("Webhook message sent. Resetting previous message timer");
        tracker.previous.time = moment();
        resolve(response.body);
      }
    });
  });
};

const is_session_valid = (session = {}) => {
  return (
    _.isEqual(session.min_age_limit, 18) &&
    (_.gt(session.available_capacity_dose1, 0) ||
      _.gt(session.available_capacity_dose2, 0))
  );
};

const process_vaccine_centers = (centers = []) => {
  return centers.filter((center) =>
    center.sessions.some((session) => is_session_valid(session))
  );
};

const process_webhook_message = (available_centers = []) => {
  return available_centers
    .reduce((accumulator, center) => {
      accumulator += `<span style="font-weight: bold; font-size: large;">${
        center.name
      }</span><br>${center.address}<br>${center.sessions
        .filter((session) => is_session_valid(session))
        .reduce((accumulator, session) => {
          accumulator += `<span style="color: #61AFEF; font-weight: bold;">${
            session.date
          } (${moment(session.date, "DD-MM-YYYY")
            .startOf("day")
            .from(
              moment().startOf("day")
            )})</span><br><ul><li><span style="color: #98C379; font-weight: bold;">${
            session.vaccine
          }</span></li><li><span style="color: ${
            _.gt(session.available_capacity_dose1, 0) ? "#98C379" : "#E06C75"
          }; font-weight: bold;">D1 : ${
            session.available_capacity_dose1
          }</span>&emsp;&emsp;<span style="color: ${
            _.gt(session.available_capacity_dose2, 0) ? "#98C379" : "#E06C75"
          }; font-weight: bold;">D2 : ${
            session.available_capacity_dose2
          }</span></li></ul>`;
          return accumulator;
        }, "")}<hr>`;
      return accumulator;
    }, "")
    .slice(0, "<hr>".length * -1);
};

const send_service_heartbeat = async (isStart = false) => {
  console.log("Sending Service Hearbeat");

  const heartbeat_message = `❤ <b>Service Heartbeat</b> ❤<br>The service ${
    isStart ? "has started" : "is running"
  } and is tracking vaccine centers in the <b>${district}</b> district<br><br>${
    isStart
      ? `<b>Hearbeat duration:</b> ${tracker.duration.hearbeat} minute(s) since last message<br><b>Cached message duration:</b> ${tracker.duration.cache} minute(s)<br><b>Polling interval:</b> ${tracker.duration.polling} second(s)`
      : `<b>Centers processed in the previous poll:</b> ${tracker.previous.centers.length}`
  }`;

  await post_to_webhook(heartbeat_message);
};

const main = async () => {
  const current_time = moment();
  const time_since_last_message = moment.duration(
    current_time.diff(tracker.previous.time)
  );

  console.log(
    `[${current_time
      .utcOffset("+05:30")
      .format("HH:mm:ss")}] Getting vaccine center updates`
  );

  const { centers: vaccine_centers = [] } = await get_vaccine_centers();
  console.log(`Received ${vaccine_centers.length} centers for processing`);

  const available_centers = process_vaccine_centers(vaccine_centers);
  const webhook_message = process_webhook_message(available_centers);

  console.log(
    `H: ${tracker.duration.hearbeat} min(s) C: ${tracker.duration.cache} min(s) P: ${tracker.duration.polling} sec(s)`
  );
  console.log(
    `${time_since_last_message
      .as("minutes")
      .toFixed(2)} minutes since last message`
  );

  if (time_since_last_message.as("minutes") > tracker.duration.hearbeat) {
    await send_service_heartbeat();
  }
  tracker.previous.centers = vaccine_centers;

  if (_.isEmpty(webhook_message)) {
    console.log("No centers available");
    return;
  }

  if (
    _.isEqual(webhook_message, tracker.previous.message) &&
    time_since_last_message.as("minutes") < tracker.duration.cache
  ) {
    console.log(
      "Duplicate message found within cache duration; skipping webhook message"
    );
    return;
  }

  console.log(
    `Found ${available_centers.length} center(s), sending webhook message`
  );
  await post_to_webhook(webhook_message);
  tracker.previous.message = webhook_message;
};

(async () => {
  await send_service_heartbeat(true);
  console.log();
})();

setInterval(async () => {
  try {
    await main();
  } catch (error) {
    console.log(`Encountered service error: ${JSON.stringify(error)}`);
    await post_to_webhook(
      `🔥 <b>Service Error!</b> 🔥 <br><br><code>${JSON.stringify(
        error
      )}</code>`
    );
  }
  console.log(
    "\n-------------------------------------------------------------------------\n"
  );
}, tracker.duration.polling * 1000);
