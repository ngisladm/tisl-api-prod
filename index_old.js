require("dotenv").config();
const express    = require("express");
const cors       = require("cors");

const authRoutes      = require("./routes/auth");
const usersRoutes     = require("./routes/users");
const profilesRoutes  = require("./routes/profiles");
const companiesRoutes = require("./routes/companies");
const screensRoutes   = require("./routes/screens");
const teamsRoutes     = require("./routes/teams");
const escalasRoutes   = require("./routes/escalas");

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: "*" }));
app.use(express.json());

app.use("/auth",      authRoutes);
app.use("/users",     usersRoutes);
app.use("/profiles",  profilesRoutes);
app.use("/companies", companiesRoutes);
app.use("/screens",   screensRoutes);
app.use("/teams",     teamsRoutes);
app.use("/escalas",   escalasRoutes);

app.get("/", (req, res) => res.json({ status: "ok", app: "SL TI API" }));

app.listen(PORT, () => {
  console.log(`🚀 API rodando em http://localhost:${PORT}`);
});
